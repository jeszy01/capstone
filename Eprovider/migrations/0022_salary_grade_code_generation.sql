-- Run after 0021_compensation_module.sql and before deploying the compensation API/UI.
-- The existing SG-01 legacy row is normalized in-place; its primary-key ID is unchanged.
DO $salary_grade_preflight$
DECLARE
  duplicate_code text;
BEGIN
  IF EXISTS (SELECT 1 FROM salary_grades WHERE btrim(coalesce(grade, '')) = '') THEN
    RAISE EXCEPTION 'Cannot add salary-grade code safeguards: a blank grade code exists.';
  END IF;

  SELECT normalized_code INTO duplicate_code
  FROM (
    SELECT CASE
      WHEN upper(btrim(grade)) = 'SG-01' THEN 'sg-001'
      ELSE lower(btrim(grade))
    END AS normalized_code
    FROM salary_grades
  ) AS normalized
  GROUP BY normalized_code
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_code IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot normalize salary-grade codes: collision for %.', duplicate_code;
  END IF;
END $salary_grade_preflight$;

UPDATE salary_grades
SET grade = 'SG-001', updated_at = now()
WHERE upper(btrim(grade)) = 'SG-01';

DO $salary_grade_nonblank_constraint$
BEGIN
  ALTER TABLE salary_grades
    ADD CONSTRAINT salary_grades_grade_nonblank_check CHECK (btrim(grade) <> '');
EXCEPTION WHEN duplicate_object THEN NULL;
END $salary_grade_nonblank_constraint$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_grades_grade_normalized
  ON salary_grades (lower(btrim(grade)));

-- Seed the sequence from both normalized rows and any not-yet-imported browser data.
-- SG-01 contributes suffix 1, so subsequent generated codes begin at SG-002.
CREATE SEQUENCE IF NOT EXISTS salary_grade_code_seq AS bigint MINVALUE 1 START WITH 1;
DO $salary_grade_sequence_seed$
DECLARE
  maximum_code bigint;
  current_sequence_value bigint;
BEGIN
  SELECT coalesce(max(substring(upper(btrim(code)) FROM '^SG-([0-9]+)$')::bigint), 0)
  INTO maximum_code
  FROM (
    SELECT grade AS code FROM salary_grades
    UNION ALL
    SELECT item->>'code' AS code
    FROM app_data AS app
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(app.value) = 'array' THEN app.value ELSE '[]'::jsonb END
    ) AS legacy_grades(item)
    WHERE app.key = 'compensation:salary-grades'
      AND app.deleted = false
  ) AS codes
  WHERE upper(btrim(code)) ~ '^SG-[0-9]+$';

  SELECT last_value INTO current_sequence_value FROM salary_grade_code_seq;
  IF maximum_code >= current_sequence_value THEN
    PERFORM setval('salary_grade_code_seq'::regclass, maximum_code + 1, false);
  END IF;
END $salary_grade_sequence_seed$;

CREATE OR REPLACE FUNCTION assign_salary_grade_code()
RETURNS trigger
LANGUAGE plpgsql
AS $salary_grade_code_function$
DECLARE
  sequence_ref regclass;
  requested_number bigint;
  current_sequence_value bigint;
  generated_number bigint;
BEGIN
  sequence_ref := format('%I.%I', TG_TABLE_SCHEMA, 'salary_grade_code_seq')::regclass;
  PERFORM pg_advisory_xact_lock(
    hashtext(TG_TABLE_SCHEMA || '.salary_grades'),
    hashtext('salary-grade-code')
  );

  NEW.grade := btrim(coalesce(NEW.grade, ''));
  IF NEW.grade = '' THEN
    generated_number := nextval(sequence_ref);
    NEW.grade := 'SG-' || CASE
      WHEN length(generated_number::text) < 3 THEN lpad(generated_number::text, 3, '0')
      ELSE generated_number::text
    END;
  ELSE
    requested_number := substring(upper(NEW.grade) FROM '^SG-([0-9]+)$')::bigint;
    IF requested_number IS NOT NULL THEN
      EXECUTE format('SELECT last_value FROM %I.%I', TG_TABLE_SCHEMA, 'salary_grade_code_seq')
        INTO current_sequence_value;
      IF requested_number >= current_sequence_value THEN
        PERFORM setval(sequence_ref, requested_number + 1, false);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$salary_grade_code_function$;

DROP TRIGGER IF EXISTS salary_grades_assign_code ON salary_grades;
CREATE TRIGGER salary_grades_assign_code
  BEFORE INSERT OR UPDATE OF grade ON salary_grades
  FOR EACH ROW EXECUTE FUNCTION assign_salary_grade_code();

INSERT INTO compensation_legacy_imports (id, imported_at, counts)
VALUES ('salary-grade-code-generation-v1', now(), '{"migration":"0022"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
