import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, ShieldCheck, Pencil } from "lucide-react";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { useLocation, useNavigate } from "react-router-dom";
import { hmoTabs, hmoTabForPath } from "./hmoNavigation";
import {
  Button,
  Card,
  Empty,
  ErrorAlert,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Tabs,
  RevealToggle,
  TextInput,
  ghost,
  input,
  maskValue,
} from "../../components/common/ui";
import { employeeService } from "../employees/employeeService";
import type { Employee } from "../../types/domain";
import { hmoService } from "./hmoService";
import { hasOpenHmoEnrollment, hmoEligibilityDate, isHmoEmployeeEligible } from "./hmoEnrollment";
import { recordAudit } from "../audit/auditService";
import { localToday } from "../../components/common/tableUi";
import { can } from "../auth/permissions";
import { StatusBadge } from "../../components/common/StatusBadge";
import type {
  HmoDependent,
  HmoEnrollment,
  HmoPlan,
  HmoProvider,
} from "./hmoTypes";
// The browser's local date; toISOString() would give yesterday's date before 8 AM in the Philippines.
const today = localToday;
const money = (n: number | null | undefined) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        maximumFractionDigits: 2,
      }).format(n);
export default function HmoBenefits({
  section = "hmo",
}: {
  section?: "hmo" | "dependents";
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tab = section === "dependents" ? "dependents" : hmoTabForPath(pathname);
  const [providers, setProviders] = useState<HmoProvider[]>([]),
    [plans, setPlans] = useState<HmoPlan[]>([]),
    [enrollments, setEnrollments] = useState<HmoEnrollment[]>([]),
    [dependents, setDependents] = useState<HmoDependent[]>([]),
    [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [planModal, setPlanModal] = useState(false),
    [editPlanModal, setEditPlanModal] = useState(false),
    [selectedPlanId, setSelectedPlanId] = useState<string | null>(null),
    [enrollModal, setEnrollModal] = useState(false),
    [dependentModal, setDependentModal] = useState(false);
  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [p, pl, e, d, emp] = await Promise.all([
        hmoService.providers(),
        hmoService.plans(),
        hmoService.enrollments(),
        hmoService.dependents(),
        employeeService.getAll(),
      ]);
      setProviders(p);
      setPlans(pl);
      setEnrollments(e);
      setDependents(d);
      setEmployees(emp);
    } catch (error) {
      console.error(error);
      setLoadError(
        "HMO records could not be loaded. Existing data and actions are unavailable until the connection is restored.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const maxicareProviders = providers.filter(
    (p) => p.name.trim().toLowerCase() === "maxicare",
  );
  const maxicareProvider =
    maxicareProviders.find((p) => p.status === "Active") ??
    maxicareProviders[0];
  // HMO Plan tab: a list of saved plans; clicking one opens its detail view.
  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const providerFor = (plan: HmoPlan) =>
    providers.find((provider) => provider.id === plan.providerId) ?? maxicareProvider;
  // Employees can be enrolled in any active Maxicare plan.
  const enrollmentPlans = plans.filter(
    (p) => maxicareProviders.some((provider) => provider.id === p.providerId) && p.status === "Active",
  );
  const availableEnrollmentEmployees = employees.filter(
    (employee) => employee.status === "Active" && employee.employmentStatus?.toLowerCase() !== "resigned" && !hasOpenHmoEnrollment(employee.id, enrollments),
  );
  const employeeMap = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );
  const activeEnrollments = enrollments.filter(
    (e) =>
      e.status === "Active" &&
      e.approvalStatus === "Approved" &&
      e.maxicareStatus === "Active",
  );
  return (
    <div>
      {" "}
      <PageHeader
        title={
          section === "dependents"
            ? "Dependents"
            : tab === "plan"
              ? "HMO Plan"
              : tab === "history"
                ? "HMO Records"
                : "HMO"
        }
        actions={
          !loading && !loadError && can("hmo.manage") ? (
            <>
              {tab === "plan" && !selectedPlan && (
                <Button onClick={() => setPlanModal(true)}>
                  <Plus size={15} />
                  Add Plan
                </Button>
              )}
              {tab === "enrollment" && (
                <Button
                  disabled={
                    !availableEnrollmentEmployees.length || !enrollmentPlans.length
                  }
                  onClick={() => setEnrollModal(true)}
                >
                  <Plus size={15} />
                  Enroll Employee
                </Button>
              )}
              {tab === "dependents" && (
                <Button
                  disabled={!activeEnrollments.length}
                  onClick={() => setDependentModal(true)}
                >
                  <Plus size={15} />
                  Add Dependent
                </Button>
              )}
            </>
          ) : undefined
        }
      />{" "}
      {section === "hmo" && (
        <Tabs
          label="HMO & Benefits sections"
          tabs={hmoTabs}
          value={tab}
          onChange={(id) =>
            navigate(
              hmoTabs.find((item) => item.id === id)?.to ?? "/hmo-benefits/hmo",
            )
          }
          idPrefix="hmo-tab"
          panelId="hmo-panel"
        />
      )}{" "}
      <div
        id="hmo-panel"
        role="tabpanel"
        aria-labelledby={section === "hmo" ? `hmo-tab-${tab}` : undefined}
        aria-label={section === "hmo" ? undefined : "Dependents"}
      >
        {loadError && (
          <ErrorAlert onRetry={() => void load()}>{loadError}</ErrorAlert>
        )}
        {loading ? (
          <Card className="mt-4">
            <LoadingState>Loading HMO records…</LoadingState>
          </Card>
        ) : (
          <>
            {tab === "plan" &&
              (selectedPlan ? (
                <PlanSection
                  provider={providerFor(selectedPlan)}
                  plan={selectedPlan}
                  onBack={() => setSelectedPlanId(null)}
                  onEdit={() => setEditPlanModal(true)}
                />
              ) : (
                <PlanList plans={plans} providerFor={providerFor} onOpen={setSelectedPlanId} />
              ))}{" "}
            {tab === "enrollment" && <>
              <EnrollmentSection
                enrollments={enrollments}
                plans={plans}
                employeeMap={employeeMap}
                onChanged={() => void load()}
              />
              {!enrollmentPlans.length && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">An active Maxicare plan is required before employees can be enrolled.</p>}
              {enrollmentPlans.length > 0 && !availableEnrollmentEmployees.length && <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-[12px] text-blue-900">There are no active employees without an open HMO enrollment to select.</p>}
            </>}{" "}
            {tab === "dependents" && (
              <DependentSection
                dependents={dependents}
                enrollments={enrollments}
                employeeMap={employeeMap}
                onChanged={() => void load()}
              />
            )}{" "}
            {tab === "history" && (
              <HmoRecordsSection
                enrollments={enrollments}
                plans={plans}
                dependents={dependents}
                employeeMap={employeeMap}
                onChanged={() => void load()}
              />
            )}
          </>
        )}
      </div>{" "}
      {planModal && (
        <PlanFormModal
          provider={maxicareProvider}
          onClose={() => setPlanModal(false)}
          onSaved={() => {
            setPlanModal(false);
            load();
          }}
        />
      )}
      {editPlanModal && selectedPlan && (
        <PlanFormModal
          plan={selectedPlan}
          onClose={() => setEditPlanModal(false)}
          onSaved={() => {
            setEditPlanModal(false);
            void load();
          }}
        />
      )}
      {enrollModal && (
        <EnrollmentModal
          employees={employees}
          enrollments={enrollments}
          plans={enrollmentPlans}
          onClose={() => setEnrollModal(false)}
          onSaved={() => {
            setEnrollModal(false);
            load();
          }}
        />
      )}
      {dependentModal && (
        <DependentModal
          enrollments={activeEnrollments}
          employeeMap={employeeMap}
          onClose={() => setDependentModal(false)}
          onSaved={() => {
            setDependentModal(false);
            load();
          }}
        />
      )}{" "}
    </div>
  );
}
function formatHmoDate(value?: string | null) {
  if (!value) return "Unavailable";
  // Same style as every other screen ("Oct 3, 2026"); timestamps are shown in the browser's local date.
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
/** HMO Plan tab list: one card per saved plan; clicking a card opens its detail view. */
function PlanList({
  plans,
  providerFor,
  onOpen,
}: {
  plans: HmoPlan[];
  providerFor: (plan: HmoPlan) => HmoProvider | undefined;
  onOpen: (planId: string) => void;
}) {
  if (!plans.length)
    return (
      <Card className="mt-4">
        <Empty>No plans yet</Empty>
      </Card>
    );
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} provider={providerFor(plan)} onOpen={() => onOpen(plan.id)} />
      ))}
    </div>
  );
}
function PlanCard({ plan, provider, onOpen }: { plan: HmoPlan; provider?: HmoProvider; onOpen: () => void }) {
  const [shown, setShown] = useState(false);
  const active = plan.status === "Active";
  return (
    // The card opens the plan; it is a role="button" div so the eye button can sit inside it.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      className="block w-full cursor-pointer rounded-2xl border border-[#dce7f7] bg-gradient-to-r from-[#f1f7ff] to-white p-4 text-left shadow-[0_2px_8px_rgba(15,23,42,0.025)] transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
    >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#dce9fb] bg-[#e4efff] px-1 text-center text-[10px] font-extrabold tracking-tight text-[#0862df]">
              {(provider?.name ?? "HMO").toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[12px] text-[#647796]">{provider?.name ?? "Provider unavailable"}</div>
              <div className="truncate text-[15px] font-semibold text-[#142b50]">{plan.name}</div>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
            {active ? "Active" : "Inactive"}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <dt className="text-[#647796]">Coverage Period</dt>
            <dd className="m-0 mt-1 font-semibold text-[#142b50]">
              {formatHmoDate(plan.coverageStart)} – {formatHmoDate(plan.coverageEnd)}
            </dd>
          </div>
          <div>
            <dt className="text-[#647796]">Annual Benefit Limit</dt>
            <dd className="m-0 mt-1 flex items-center justify-between gap-2 font-semibold text-[#142b50]">
              <span className="min-w-0 truncate">{maskValue(shown, money(plan.annualBenefitLimit))}</span>
              <RevealToggle inline shown={shown} onToggle={() => setShown((value) => !value)} />
            </dd>
          </div>
        </dl>
    </div>
  );
}
function PlanSection({
  provider,
  plan,
  onBack,
  onEdit,
}: {
  provider?: HmoProvider;
  plan: HmoPlan;
  onBack: () => void;
  onEdit: () => void;
}) {
  const [shown, setShown] = useState(false);
  const hidden = (value: string) => maskValue(shown, value);
  const contribution = (
    premium: number | null | undefined,
    share: number | null | undefined,
  ) =>
    hidden(premium != null && share != null
      ? `${money((premium * share) / 100)} (${share}%)`
      : `Unavailable (${share == null ? "share unavailable" : share + "%"})`);
  const sectionTitle = "text-[16px] font-semibold text-[#142b50]";
  const muted = "text-[12px] text-[#647796]";
  const tableLabel =
    "bg-[#f3f6fb] px-3 py-2.5 text-[12px] font-medium text-[#526987] sm:w-[30%]";
  const tableValue = "px-3 py-2.5 text-[13px] text-[#142b50]";
  const coveragePeriod = `${formatHmoDate(plan.coverageStart)} – ${formatHmoDate(plan.coverageEnd)}`;
  const benefits = [
    {
      label: "Inpatient",
      included: plan.inpatient,
      detail: "Hospital admission and inpatient services",
    },
    {
      label: "Outpatient",
      included: plan.outpatient,
      detail: "Consultations and outpatient services",
    },
    {
      label: "Emergency",
      included: plan.emergency,
      detail: "Emergency care services",
    },
    {
      label: "Preventive Care",
      included: plan.preventiveCare,
      detail: "Preventive and routine care",
    },
    { label: "Dental", included: plan.dental, detail: "Dental services" },
  ];
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={ghost} onClick={onBack}>
          Back
        </button>
        <div className="flex items-center gap-2">
          <RevealToggle shown={shown} onToggle={() => setShown((value) => !value)} />
          {can("hmo.manage") && (
            <Button onClick={onEdit}>
              <Pencil size={15} />
              Edit Plan
            </Button>
          )}
        </div>
      </div>{" "}
      <Card className="overflow-hidden border border-[#dce7f7] bg-gradient-to-r from-[#f1f7ff] to-white p-4 sm:p-5">
        {" "}
        <div className="grid gap-5 md:grid-cols-[minmax(0,1.35fr)_minmax(260px,1fr)] md:items-center">
          {" "}
          <div className="flex min-w-0 items-center gap-4">
            {" "}
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-[#dce9fb] bg-[#e4efff] px-2 text-center text-[18px] font-extrabold tracking-tight text-[#0862df]">
              {(provider?.name ?? "HMO").toUpperCase()}
            </div>{" "}
            <div className="min-w-0">
              {" "}
              <div className={muted}>HMO Provider</div>{" "}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-2xl font-bold text-[#142b50]">
                  {provider?.name ?? "Provider unavailable"}
                </h2>
                <span
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold ${provider?.status === "Active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}
                >
                  {provider?.status ?? "Unknown status"}
                </span>
              </div>{" "}
              <div className="mt-1 text-lg font-semibold text-[#142b50]">
                {plan.name}
              </div>{" "}
            </div>{" "}
          </div>{" "}
          <div className="grid gap-4 border-t border-[#d7e4f5] pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
            {" "}
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e1edff] text-[#0862df]">
                <CalendarDays size={19} />
              </div>
              <div>
                <div className={muted}>Coverage Period</div>
                <div className="mt-1 text-[14px] font-semibold text-[#142b50]">
                  {coveragePeriod}
                </div>
              </div>
            </div>{" "}
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fff3d8] text-[#a86b00]">
                <ShieldCheck size={19} />
              </div>
              <div>
                <div className={muted}>Annual Benefit Limit</div>
                <div className="mt-1 text-[18px] font-bold text-[#142b50]">
                  {hidden(money(plan.annualBenefitLimit))}
                </div>
              </div>
            </div>{" "}
          </div>{" "}
        </div>{" "}
      </Card>{" "}
      <Card className="p-4 sm:p-5">
        {" "}
        <div className="mb-4">
          <h2 className={sectionTitle}>Coverage Benefits</h2>
        </div>{" "}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {" "}
          {benefits.map((benefit) => (
            <div
              key={benefit.label}
              className="rounded-xl border border-[#e1e9f5] bg-white p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="m-0 text-[13px] font-semibold text-[#142b50]">
                  {benefit.label}
                </h3>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold ${benefit.included ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                >
                  {benefit.included ? "Included" : "Not included"}
                </span>
              </div>
              <p className={`mt-2 ${muted}`}>{benefit.detail}</p>
            </div>
          ))}{" "}
        </div>{" "}
      </Card>{" "}
      <Card className="p-4 sm:p-5">
        {" "}
        <div className="mb-4">
          <h2 className={sectionTitle}>Plan Information</h2>
          <p className={`mt-1 ${muted}`}>
            Key details for the current HMO plan.
          </p>
        </div>{" "}
        <div className="grid gap-3 lg:grid-cols-2">
          {" "}
          <div className="overflow-hidden rounded-lg border border-[#e2eaf5]">
            <table className="w-full border-collapse text-left">
              <tbody>
                {" "}
                <tr className="border-b border-[#e2eaf5]">
                  <th className={tableLabel}>Plan Name</th>
                  <td className={tableValue}>{plan.name}</td>
                </tr>{" "}
                <tr className="border-b border-[#e2eaf5]">
                  <th className={tableLabel}>Provider</th>
                  <td className={tableValue}>
                    {provider?.name ?? "Unavailable"}
                  </td>
                </tr>{" "}
                <tr className="border-b border-[#e2eaf5]">
                  <th className={tableLabel}>Plan Type</th>
                  <td className={tableValue}>HMO Plan</td>
                </tr>{" "}
                <tr>
                  <th className={tableLabel}>Monthly Employee Premium</th>
                  <td className={tableValue}>
                    {hidden(money(plan.employeeMonthlyPremium))}
                  </td>
                </tr>{" "}
              </tbody>
            </table>
          </div>{" "}
          <div className="overflow-hidden rounded-lg border border-[#e2eaf5]">
            <table className="w-full border-collapse text-left">
              <tbody>
                {" "}
                <tr className="border-b border-[#e2eaf5]">
                  <th className={tableLabel}>Coverage Start</th>
                  <td className={tableValue}>
                    {formatHmoDate(plan.coverageStart)}
                  </td>
                </tr>{" "}
                <tr className="border-b border-[#e2eaf5]">
                  <th className={tableLabel}>Coverage End</th>
                  <td className={tableValue}>
                    {formatHmoDate(plan.coverageEnd)}
                  </td>
                </tr>{" "}
                <tr className="border-b border-[#e2eaf5]">
                  <th className={tableLabel}>Annual Benefit Limit</th>
                  <td className={tableValue}>
                    {hidden(money(plan.annualBenefitLimit))}
                  </td>
                </tr>{" "}
                <tr>
                  <th className={tableLabel}>Status</th>
                  <td className={tableValue}>
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${plan.status === "Active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}
                    >
                      {plan.status}
                    </span>
                  </td>
                </tr>{" "}
              </tbody>
            </table>
          </div>{" "}
        </div>{" "}
      </Card>{" "}
      <Card className="p-4 sm:p-5">
        {" "}
        <div className="mb-4">
          <h2 className={sectionTitle}>Contribution Policy</h2>
          <p className={`mt-1 ${muted}`}>
            Premium sharing between the company and employee, based on the saved
            plan contribution percentages and company-sponsored dependent
            policy.
          </p>
        </div>{" "}
        <div className="grid gap-4 lg:grid-cols-2">
          {" "}
          <div className="rounded-xl border border-[#e1eaf7] bg-[#f7faff] p-4">
            {" "}
            <h3 className="m-0 text-[14px] font-semibold text-[#142b50]">
              Employee's Own HMO Premium
            </h3>
            <p className={`mt-1 ${muted}`}>Monthly premium for the employee.</p>{" "}
            <div className="mt-4 text-2xl font-bold text-[#142b50]">
              {hidden(money(plan.employeeMonthlyPremium))}
              <span className="ml-1 text-[12px] font-medium text-[#647796]">
                / month
              </span>
            </div>{" "}
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-[#3284f6]"
                style={{
                  width: `${Math.max(0, Math.min(100, plan.employeeCompanyShare ?? 0))}%`,
                }}
              />
            </div>{" "}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className={muted}>Employee Share</div>
                <div className="mt-1 text-[13px] font-semibold text-[#142b50]">
                  {contribution(
                    plan.employeeMonthlyPremium,
                    plan.employeeMemberShare,
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className={muted}>Company Share</div>
                <div className="mt-1 text-[13px] font-semibold text-[#142b50]">
                  {contribution(
                    plan.employeeMonthlyPremium,
                    plan.employeeCompanyShare,
                  )}
                </div>
              </div>
            </div>{" "}
          </div>{" "}
          <div className="rounded-xl border border-[#e1eaf7] bg-white p-4">
            {" "}
            <h3 className="m-0 text-[14px] font-semibold text-[#142b50]">
              Dependent Premiums
            </h3>
            <p className={`mt-1 ${muted}`}>
              One eligible spouse or child is company-sponsored; additional
              eligible dependents are employee-paid.
            </p>{" "}
            <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[12px] font-semibold text-[#14532d]">
                    One eligible sponsored dependent
                  </div>
                  <div className="mt-1 text-[11px] text-[#166534]">
                    First eligible spouse or child · company-paid 100%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-bold text-[#14532d]">
                    Company-paid
                  </div>
                  <div className="text-[11px] text-[#166534]">
                    No employee premium
                  </div>
                </div>
              </div>
            </div>{" "}
            <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[12px] font-semibold text-[#713f12]">
                    Additional eligible dependents
                  </div>
                  <div className="mt-1 text-[11px] text-[#854d0e]">
                    Subject to provider eligibility and plan terms
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-bold text-[#713f12]">
                    {hidden(money(plan.dependentMonthlyPremium))}
                  </div>
                  <div className="text-[11px] text-[#854d0e]">
                    Employee-paid premium
                  </div>
                </div>
              </div>
            </div>{" "}
            <p className={`mt-3 ${muted}`}>
              Configured additional-dependent premium:{" "}
              {hidden(money(plan.dependentMonthlyPremium))}.
            </p>{" "}
          </div>{" "}
        </div>{" "}
      </Card>{" "}
    </div>
  );
}
function EnrollmentSection({
  enrollments,
  plans,
  employeeMap,
  onChanged,
}: {
  enrollments: HmoEnrollment[];
  plans: HmoPlan[];
  employeeMap: Map<string, Employee>;
  onChanged: () => void;
}) {
  const [selectedEnrollment, setSelectedEnrollment] = useState<HmoEnrollment | null>(null);
  return (
    <>
      <Card className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[1120px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">
            {[
              "Employee",
              "Plan",
              "Eligibility Date",
              "Coverage Starts",
              "Coverage Ends",
              "Enrollment Status",
              "Action",
            ].map((h) => (
              <th key={h} className="px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {enrollments.length === 0 ? (
            <tr>
              <td colSpan={7}>
                <Empty>No HMO enrollments yet.</Empty>
              </td>
            </tr>
          ) : (
            enrollments.map((e) => {
              const employee = employeeMap.get(e.employeeId);
              const eligibilityDate = employee ? hmoEligibilityDate(employee.dateHired) : e.eligibilityDate;
              const eligibleForEffectiveDate = employee
                ? isHmoEmployeeEligible(employee, e.effectiveDate)
                : e.employeeEligibleForEffectiveDate;
              const eligibilityDetail = eligibilityDate
                ? eligibleForEffectiveDate === true
                  ? "Eligible on coverage start"
                  : e.effectiveDate < eligibilityDate
                    ? "Coverage starts before eligibility"
                    : eligibleForEffectiveDate === false
                      ? "Employee not active for coverage start"
                      : "Eligibility not verified"
                : "Hire date unavailable; eligibility cannot be calculated";
              return <tr key={e.id} className="border-b border-[#eef1f6]">
                <td className="px-4 py-3 font-semibold">
                  {employeeMap.get(e.employeeId)?.name ?? e.employeeId}
                </td>
                <td className="px-4 py-3">
                  {plans.find((p) => p.id === e.planId)?.name ?? "Unavailable"}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-[#142b50]">{formatHmoDate(eligibilityDate)}</div>
                  <div className={`mt-1 max-w-[210px] text-[11px] leading-snug ${eligibilityDate ? "text-[#6b7794]" : "text-amber-700"}`}>{eligibilityDetail}</div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatHmoDate(e.effectiveDate)}</td>
                <td className="px-4 py-3">
                  {formatHmoDate(e.expirationDate)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={enrollmentDisplayStatus(e)}/>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="font-semibold text-blue-600 hover:text-blue-800"
                    onClick={() => setSelectedEnrollment(e)}
                  >
                    View
                  </button>
                </td>
              </tr>;
            })
          )}
        </tbody>
      </table>
      </Card>
      {selectedEnrollment && (
        <EnrollmentViewModal
          enrollment={selectedEnrollment}
          employee={employeeMap.get(selectedEnrollment.employeeId)}
          plan={plans.find((p) => p.id === selectedEnrollment.planId)}
          onClose={() => setSelectedEnrollment(null)}
          onChanged={() => { setSelectedEnrollment(null); onChanged(); }}
        />
      )}
    </>
  );
}

function enrollmentDisplayStatus(enrollment: HmoEnrollment) {
  if (enrollment.status === "Terminated") return "Terminated";
  if (enrollment.status === "Expired") return "Expired";
  if (enrollment.status === "Rejected" || enrollment.approvalStatus === "Rejected") return "Rejected";
  if (enrollment.status === "Active" && enrollment.maxicareStatus === "Active") return "Active";
  if (enrollment.approvalStatus === "Approved" && enrollment.maxicareStatus === "Pending") return "Awaiting Maxicare Approval";
  if (enrollment.approvalStatus === "Approved") return "Ready for Submission";
  return "Pending HR Approval";
}

function EnrollmentViewModal({
  enrollment,
  employee,
  plan,
  onClose,
  onChanged,
}: {
  enrollment: HmoEnrollment;
  employee?: Employee;
  plan?: HmoPlan;
  onClose: () => void;
  onChanged: () => void;
}) {
  const pending = enrollment.approvalStatus === "Pending" && ["Pending", "Submitted"].includes(enrollment.status);
  const name = employee?.name ?? "this employee";
  const steps: WorkflowStep[] = [
    ...(pending ? [
      { key: "approve", label: "Approve Enrollment", run: () => hmoService.approveEnrollment(enrollment.id), audit: `Approved the HMO enrollment of ${name}.` },
      { key: "reject", label: "Reject", danger: true, needs: "reason" as const, run: (reason: string) => hmoService.rejectEnrollment(enrollment.id, reason), audit: `Rejected the HMO enrollment of ${name}.` },
    ] : []),
    ...(enrollment.approvalStatus === "Approved" && enrollment.maxicareStatus !== "Active" && !["Terminated", "Rejected", "Expired"].includes(enrollment.status) ? [
      { key: "activate", label: "Record Maxicare Approval", needs: "reference" as const, run: (reference: string) => hmoService.activateEnrollment(enrollment.id, reference), audit: `Recorded Maxicare approval for ${name}.` },
    ] : []),
    // A pending enrollment is rejected rather than terminated.
    ...(!pending && enrollment.approvalStatus === "Approved" && ["Pending", "Submitted", "Active"].includes(enrollment.status) ? [
      { key: "terminate", label: "Terminate", danger: true, confirm: `End ${name}'s HMO coverage? Their dependents can no longer be changed under this enrollment.`, run: () => hmoService.terminateEnrollment(enrollment.id), audit: `Terminated the HMO enrollment of ${name}.` },
    ] : []),
  ];
  return (
    <Modal title="Enrollment Details" onClose={onClose}>
      <div className="grid gap-3 text-[13px] text-[#142b50]">
        <div className="rounded-xl border border-[#e3e7ef] bg-[#f8fafc] p-3">
          <div className="text-[11px] uppercase tracking-wide text-[#6b7794]">Enrollment Status</div>
          <div className="mt-1 font-semibold">{enrollmentDisplayStatus(enrollment)}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><div className="text-[11px] text-[#6b7794]">Employee</div><div className="font-medium">{employee?.name ?? enrollment.employeeId}</div></div>
          <div><div className="text-[11px] text-[#6b7794]">Plan</div><div className="font-medium">{plan?.name ?? "Unavailable"}</div></div>
          <div><div className="text-[11px] text-[#6b7794]">Eligibility Date</div><div className="font-medium">{formatHmoDate(enrollment.eligibilityDate)}</div></div>
          <div><div className="text-[11px] text-[#6b7794]">Coverage Period</div><div className="font-medium">{formatHmoDate(enrollment.effectiveDate)} – {formatHmoDate(enrollment.expirationDate)}</div></div>
        </div>
        {enrollment.maxicareReference && <div><div className="text-[11px] text-[#6b7794]">Maxicare Reference</div><div className="font-medium">{enrollment.maxicareReference}</div></div>}
        {enrollment.rejectionReason && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700"><div className="text-[11px] font-semibold uppercase tracking-wide">Rejection Reason</div><div className="mt-1">{enrollment.rejectionReason}</div></div>}
      </div>
      <WorkflowActions steps={steps} onDone={onChanged} onClose={onClose} />
    </Modal>
  );
}
function DependentSection({
  dependents,
  enrollments,
  employeeMap,
  onChanged,
}: {
  dependents: HmoDependent[];
  enrollments: HmoEnrollment[];
  employeeMap: Map<string, Employee>;
  onChanged: () => void;
}) {
  const [selectedDependent, setSelectedDependent] = useState<HmoDependent | null>(null);
  const hasActiveEnrollment = enrollments.some(
    (enrollment) =>
      enrollment.status === "Active" &&
      enrollment.approvalStatus === "Approved" &&
      enrollment.maxicareStatus === "Active",
  );
  return (
    <>
    {!hasActiveEnrollment && (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-900">
        Dependents can be added only after the employee enrollment is <b>Active</b> and has confirmed Maxicare approval. Open an employee enrollment and use <b>View</b> to approve or record Maxicare approval first.
      </div>
    )}
    <Card className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[1050px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">
            {[
              "Employee",
              "Dependent Name",
              "Relationship",
              "Date of Birth",
              "Sponsorship",
              "Employee Premium",
              "Company Premium",
              "Enrollment Status",
              "Action",
            ].map((h) => (
              <th key={h} className="px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dependents.length === 0 ? (
            <tr>
              <td colSpan={9}>
                <Empty>No dependents enrolled.</Empty>
              </td>
            </tr>
          ) : (
            dependents.map((d) => {
              const e = enrollments.find((x) => x.id === d.enrollmentId);
              return (
                <tr key={d.id} className="border-b border-[#eef1f6]">
                  <td className="px-4 py-3">
                    {e
                      ? (employeeMap.get(e.employeeId)?.name ?? e.employeeId)
                      : "Unavailable"}
                  </td>
                  <td className="px-4 py-3 font-semibold">{d.name}</td>
                  <td className="px-4 py-3">{d.relationship}</td>
                  <td className="px-4 py-3">
                    {formatHmoDate(d.dateOfBirth)}
                  </td>
                  <td className="px-4 py-3">
                    {d.companySponsored ? "Company-sponsored" : "Employee-paid"}
                  </td>
                  <td className="px-4 py-3">{money(d.employeeShare)}</td>
                  <td className="px-4 py-3">{money(d.companyShare)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={dependentDisplayStatus(d)}/>
                    <div className="mt-1 text-[11px] text-[#6b7794]">
                      {d.eligibilityStatus}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-semibold text-blue-600 hover:text-blue-800"
                      onClick={() => setSelectedDependent(d)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </Card>
    {selectedDependent && (
      <DependentViewModal
        dependent={selectedDependent}
        employee={(() => {
          const enrollment = enrollments.find((item) => item.id === selectedDependent.enrollmentId);
          return enrollment ? employeeMap.get(enrollment.employeeId) : undefined;
        })()}
        enrollment={enrollments.find((item) => item.id === selectedDependent.enrollmentId)}
        onClose={() => setSelectedDependent(null)}
        onChanged={() => { setSelectedDependent(null); onChanged(); }}
      />
    )}
    </>
  );
}

function dependentDisplayStatus(dependent: HmoDependent) {
  if (dependent.status === "Terminated") return "Terminated";
  if (dependent.status === "Expired") return "Expired";
  if (dependent.status === "Rejected" || dependent.approvalStatus === "Rejected") return "Rejected";
  if (dependent.status === "Active" && dependent.maxicareStatus === "Active") return "Active";
  if (dependent.approvalStatus === "Approved" && dependent.maxicareStatus === "Pending") return "Awaiting Maxicare Approval";
  if (dependent.approvalStatus === "Approved") return "Ready for Submission";
  return "Pending HR Approval";
}

function DependentViewModal({
  dependent,
  employee,
  enrollment,
  onClose,
  onChanged,
}: {
  dependent: HmoDependent;
  employee?: Employee;
  enrollment?: HmoEnrollment;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Every dependent step needs the employee's own coverage to be approved and active with Maxicare.
  const coverageActive = Boolean(enrollment && enrollment.status === "Active" && enrollment.approvalStatus === "Approved" && enrollment.maxicareStatus === "Active");
  const pending = dependent.approvalStatus === "Pending" && ["Pending", "Submitted"].includes(dependent.status);
  const open = !["Terminated", "Rejected", "Expired"].includes(dependent.status);
  const name = dependent.name;
  const steps: WorkflowStep[] = !coverageActive ? [] : [
    ...(pending ? [
      { key: "approve", label: "Approve Dependent", run: () => hmoService.approveDependent(dependent.id), audit: `Approved HMO dependent ${name}.` },
      { key: "reject", label: "Reject", danger: true, needs: "reason" as const, run: (reason: string) => hmoService.rejectDependent(dependent.id, reason), audit: `Rejected HMO dependent ${name}.` },
    ] : []),
    ...(open && dependent.approvalStatus === "Approved" && ["Not Submitted", "Rejected"].includes(dependent.maxicareStatus ?? "Not Submitted") ? [
      { key: "submit", label: "Submit to Maxicare", run: () => hmoService.submitDependentToMaxicare(dependent.id), audit: `Submitted HMO dependent ${name} to Maxicare.` },
    ] : []),
    ...(open && dependent.approvalStatus === "Approved" && dependent.maxicareStatus === "Pending" && dependent.status !== "Active" ? [
      { key: "activate", label: "Record Maxicare Approval", needs: "reference" as const, run: (reference: string) => hmoService.activateDependent(dependent.id, reference), audit: `Recorded Maxicare approval for HMO dependent ${name}.` },
    ] : []),
    // A pending dependent is rejected rather than terminated.
    ...(!pending && dependent.approvalStatus === "Approved" && ["Active", "Submitted"].includes(dependent.status) ? [
      { key: "terminate", label: "Terminate", danger: true, confirm: `End HMO coverage for ${name}?`, run: () => hmoService.terminateDependent(dependent.id), audit: `Terminated HMO dependent ${name}.` },
    ] : []),
  ];
  return (
    <Modal title="Dependent Details" onClose={onClose}>
      <div className="grid gap-3 text-[13px] text-[#142b50]">
        <div className="rounded-xl border border-[#e3e7ef] bg-[#f8fafc] p-3">
          <div className="text-[11px] uppercase tracking-wide text-[#6b7794]">Enrollment Status</div>
          <div className="mt-1 font-semibold">{dependentDisplayStatus(dependent)}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><div className="text-[11px] text-[#6b7794]">Employee</div><div className="font-medium">{employee?.name ?? "Unavailable"}</div></div>
          <div><div className="text-[11px] text-[#6b7794]">Dependent</div><div className="font-medium">{dependent.name}</div></div>
          <div><div className="text-[11px] text-[#6b7794]">Relationship</div><div className="font-medium">{dependent.relationship}</div></div>
          <div><div className="text-[11px] text-[#6b7794]">Date of Birth</div><div className="font-medium">{formatHmoDate(dependent.dateOfBirth)}</div></div>
          <div><div className="text-[11px] text-[#6b7794]">Coverage Period</div><div className="font-medium">{formatHmoDate(dependent.effectiveDate)} – {formatHmoDate(dependent.expirationDate ?? enrollment?.expirationDate)}</div></div>
          <div><div className="text-[11px] text-[#6b7794]">Sponsorship</div><div className="font-medium">{dependent.companySponsored ? "Company-sponsored" : "Employee-paid"}</div></div>
        </div>
        {dependent.maxicareReference && <div><div className="text-[11px] text-[#6b7794]">Maxicare Reference</div><div className="font-medium">{dependent.maxicareReference}</div></div>}
        {dependent.rejectionReason && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700"><div className="text-[11px] font-semibold uppercase tracking-wide">Rejection Reason</div><div className="mt-1">{dependent.rejectionReason}</div></div>}
        {!coverageActive && open && <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">The employee's own HMO enrollment must be approved and active with Maxicare before this dependent can be reviewed.</p>}
      </div>
      <WorkflowActions steps={steps} onDone={onChanged} onClose={onClose} />
    </Modal>
  );
}

type WorkflowStep = { key: string; label: string; danger?: boolean; needs?: "reason" | "reference"; confirm?: string; audit: string; run: (value: string) => Promise<unknown> };
/** Action buttons for an HMO record. Steps that need a reason, a Maxicare reference or a confirmation open an inline
 * form first; the others run on click. Errors from the server stay visible in the dialog. */
function WorkflowActions({ steps, onDone, onClose }: { steps: WorkflowStep[]; onDone: () => void; onClose: () => void }) {
  const [active, setActive] = useState<WorkflowStep | null>(null),
    [value, setValue] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const run = async (step: WorkflowStep) => {
    if (step.needs && !value.trim()) return;
    setSaving(true);
    setError("");
    try {
      await step.run(value.trim());
      recordAudit({ action: step.label, module: "HMO & Benefits", description: step.audit });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "The HMO record could not be updated.");
      setSaving(false);
    }
  };
  const open = (step: WorkflowStep) => { setError(""); setValue(""); if (step.needs || step.confirm) setActive(step); else void run(step); };
  return (
    <>
      {error && <p role="alert" className="mb-0 mt-4 rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{error}</p>}
      {active ? (
        <div className="mt-5 rounded-xl border border-[#e3e7ef] bg-[#f8fafc] p-4">
          {active.needs === "reason" && <Field label="Reason for rejection"><textarea className={`${input} min-h-20`} maxLength={500} autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></Field>}
          {active.needs === "reference" && <Field label="Maxicare reference no."><TextInput autoFocus maxLength={100} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Reference from the Maxicare approval" /></Field>}
          {active.confirm && <p className="m-0 text-[13px] text-[#526079]">{active.confirm}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className={ghost} disabled={saving} onClick={() => setActive(null)}>Back</button>
            <Button className={active.danger ? "!bg-red-600 hover:!bg-red-700" : ""} disabled={saving || Boolean(active.needs && !value.trim())} onClick={() => void run(active)}>{saving ? "Saving…" : active.label}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {can("hmo.manage") && steps.map((step) => step.danger
            ? <button key={step.key} type="button" className={`${ghost} border-red-200 text-red-700 hover:bg-red-50`} disabled={saving} onClick={() => open(step)}>{step.label}</button>
            : <Button key={step.key} disabled={saving} onClick={() => open(step)}>{saving ? "Saving…" : step.label}</Button>)}
          <button type="button" className={ghost} disabled={saving} onClick={onClose}>Close</button>
        </div>
      )}
    </>
  );
}

/** Add Plan (empty) and Edit Plan share this form. The employee premium split is fixed by company policy. */
function PlanFormModal({
  plan,
  provider,
  onClose,
  onSaved,
}: {
  plan?: HmoPlan;
  provider?: HmoProvider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState(() => plan ? {
    name: plan.name,
    start: plan.coverageStart,
    end: plan.coverageEnd,
    limit:
      plan.annualBenefitLimit == null ? "" : String(plan.annualBenefitLimit),
    employeePremium:
      plan.employeeMonthlyPremium == null
        ? ""
        : String(plan.employeeMonthlyPremium),
    dependentPremium:
      plan.dependentMonthlyPremium == null
        ? ""
        : String(plan.dependentMonthlyPremium),
    inpatient: plan.inpatient,
    outpatient: plan.outpatient,
    emergency: plan.emergency,
    preventive: plan.preventiveCare,
    dental: plan.dental,
    employeeCompanyShare: String(plan.employeeCompanyShare),
    employeeMemberShare: String(plan.employeeMemberShare),
    dependentCompanyShare: String(plan.dependentCompanyShare),
    dependentMemberShare: String(plan.dependentMemberShare),
    collectPayroll: plan.collectEmployeeShareViaPayroll,
    status: plan.status,
  } : {
    name: "",
    start: "",
    end: "",
    limit: "",
    employeePremium: "",
    dependentPremium: "",
    inpatient: false,
    outpatient: false,
    emergency: false,
    preventive: false,
    dental: false,
    employeeCompanyShare: "100",
    employeeMemberShare: "0",
    dependentCompanyShare: "0",
    dependentMemberShare: "100",
    collectPayroll: true,
    status: "Active" as HmoPlan["status"],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    if (!f.name.trim() || !f.start || !f.end) {
      setError("Plan name and both coverage dates are required.");
      return;
    }
    if (f.end < f.start) {
      setError("Coverage end date must be on or after the start date.");
      return;
    }
    const numericFields = [
      f.employeeCompanyShare,
      f.employeeMemberShare,
      f.dependentCompanyShare,
      f.dependentMemberShare,
    ];
    if (
      numericFields.some(
        (value) =>
          value.trim() === "" ||
          !Number.isFinite(Number(value)) ||
          Number(value) < 0 ||
          Number(value) > 100,
      )
    ) {
      setError("Contribution percentages must be numbers from 0 to 100.");
      return;
    }
    if (
      Number(f.employeeCompanyShare) !== 100 ||
      Number(f.employeeMemberShare) !== 0
    ) {
      setError(
        "Company policy requires the company to pay 100% of the employee’s own HMO premium.",
      );
      return;
    }
    if (
      f.limit.trim() !== "" &&
      (!Number.isFinite(Number(f.limit)) || Number(f.limit) < 0)
    ) {
      setError("Annual benefit limit must be zero or greater.");
      return;
    }
    if (
      [f.employeePremium, f.dependentPremium].some(
        (value) =>
          value.trim() !== "" &&
          (!Number.isFinite(Number(value)) || Number(value) < 0),
      )
    ) {
      setError("Monthly premiums must be zero or greater.");
      return;
    }
    setSaving(true);
    try {
      const values = {
        name: f.name.trim(),
        coverageStart: f.start,
        coverageEnd: f.end,
        annualBenefitLimit: f.limit.trim() === "" ? null : Number(f.limit),
        inpatient: f.inpatient,
        outpatient: f.outpatient,
        emergency: f.emergency,
        preventiveCare: f.preventive,
        dental: f.dental,
        employeeCompanyShare: Number(f.employeeCompanyShare),
        employeeMemberShare: Number(f.employeeMemberShare),
        dependentCompanyShare: Number(f.dependentCompanyShare),
        dependentMemberShare: Number(f.dependentMemberShare),
        employeeMonthlyPremium:
          f.employeePremium.trim() === "" ? null : Number(f.employeePremium),
        dependentMonthlyPremium:
          f.dependentPremium.trim() === "" ? null : Number(f.dependentPremium),
        collectEmployeeShareViaPayroll: f.collectPayroll,
        status: f.status,
      };
      if (plan) await hmoService.updatePlan(plan.id, { providerId: plan.providerId, ...values });
      else {
        const p = provider ?? (await hmoService.createProvider({ name: "Maxicare", status: "Active" }));
        await hmoService.createPlan({ providerId: p.id, ...values });
      }
      recordAudit({
        action: plan ? "Updated HMO plan" : "Created HMO plan",
        module: "HMO & Benefits",
        description: `${plan ? "Updated" : "Created"} HMO plan ${f.name.trim()}.`,
      });
      onSaved();
    } catch (err) {
      console.error("HMO plan update failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save the HMO plan. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={plan ? "Edit HMO Plan" : "Add Plan"} onClose={onClose}>
      {" "}
      <div className="grid gap-4">
        {" "}
        {error && <ErrorAlert>{error}</ErrorAlert>}{" "}
        <Field label="HMO Provider">
          <TextInput value="Maxicare" readOnly />
        </Field>{" "}
        <Field label="Plan Name">
          <TextInput
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="Corporate Gold"
          />
        </Field>{" "}
        <div className="grid grid-cols-2 gap-3">
          {" "}
          <Field label="Coverage Start">
            <TextInput
              type="date"
              value={f.start}
              onChange={(e) => setF({ ...f, start: e.target.value })}
            />
          </Field>{" "}
          <Field label="Coverage End">
            <TextInput
              type="date"
              value={f.end}
              onChange={(e) => setF({ ...f, end: e.target.value })}
            />
          </Field>{" "}
        </div>{" "}
        <Field label="Annual Benefit Limit">
          <TextInput
            type="number"
            min="0"
            value={f.limit}
            onChange={(e) => setF({ ...f, limit: e.target.value })}
          />
        </Field>{" "}
        <div className="grid grid-cols-2 gap-3">
          {" "}
          <Field label="Employee Monthly Premium">
            <TextInput
              type="number"
              min="0"
              value={f.employeePremium}
              onChange={(e) => setF({ ...f, employeePremium: e.target.value })}
            />
          </Field>{" "}
          <Field label="Dependent Monthly Premium">
            <TextInput
              type="number"
              min="0"
              value={f.dependentPremium}
              onChange={(e) => setF({ ...f, dependentPremium: e.target.value })}
            />
          </Field>{" "}
        </div>{" "}
        <div>
          <div className="mb-2 text-[13px] font-semibold">
            Coverage Benefits
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {(
              [
                ["inpatient", "Inpatient"],
                ["outpatient", "Outpatient"],
                ["emergency", "Emergency"],
                ["preventive", "Preventive Care"],
                ["dental", "Dental"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2 rounded-lg border border-[#e3e7ef] p-3"
              >
                <input
                  type="checkbox"
                  checked={f[key]}
                  onChange={(e) => setF({ ...f, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </div>{" "}
        <div className="rounded-xl border border-[#e3e7ef] p-3">
          <div className="mb-3 text-[13px] font-semibold">
            Contribution Policy (%)
          </div>
          <div className="grid grid-cols-2 gap-3">
            {" "}
            <Field label="Employee premium — company share">
              <TextInput
                type="number"
                min="0"
                max="100"
                value={f.employeeCompanyShare}
                onChange={(e) =>
                  setF({ ...f, employeeCompanyShare: e.target.value })
                }
              />
            </Field>{" "}
            <Field label="Employee premium — employee share">
              <TextInput
                type="number"
                min="0"
                max="100"
                value={f.employeeMemberShare}
                onChange={(e) =>
                  setF({ ...f, employeeMemberShare: e.target.value })
                }
              />
            </Field>{" "}
            <Field label="Dependent premium — company share">
              <TextInput
                type="number"
                min="0"
                max="100"
                value={f.dependentCompanyShare}
                onChange={(e) =>
                  setF({ ...f, dependentCompanyShare: e.target.value })
                }
              />
            </Field>{" "}
            <Field label="Dependent premium — employee share">
              <TextInput
                type="number"
                min="0"
                max="100"
                value={f.dependentMemberShare}
                onChange={(e) =>
                  setF({ ...f, dependentMemberShare: e.target.value })
                }
              />
            </Field>{" "}
          </div>
          <label className="mt-3 flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={f.collectPayroll}
              onChange={(e) => setF({ ...f, collectPayroll: e.target.checked })}
            />
            Collect employee-paid HMO share through payroll
          </label>
          <p className="mt-2 text-[11px] text-[#6b7794]">
            The company must cover 100% of the employee’s own HMO premium. One
            eligible spouse or child is company-sponsored under the existing
            policy.
          </p>
        </div>{" "}
        <Field label="Plan Status">
          <select
            className={input}
            value={f.status}
            onChange={(e) =>
              setF({ ...f, status: e.target.value as HmoPlan["status"] })
            }
          >
            <option value="Draft">Draft</option>
            <option value="Active">Active</option>
            <option value="Expiring">Expiring</option>
            <option value="Expired">Expired</option>
            <option value="Archived">Archived</option>
          </select>
        </Field>{" "}
      </div>{" "}
      <div className="mt-6 flex justify-end gap-2">
        <button className={ghost} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <Button
          disabled={saving || !f.name.trim() || !f.start || !f.end}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : plan ? "Save Changes" : "Add Plan"}
        </Button>
      </div>{" "}
    </Modal>
  );
}
function EnrollmentModal({
  employees,
  enrollments,
  plans,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  enrollments: HmoEnrollment[];
  plans: HmoPlan[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    planId: plans.length === 1 ? plans[0].id : "",
    employeeId: "",
    effective: today(),
    expiration: plans.length === 1 ? plans[0].coverageEnd : "",
  });
  const plan = plans.find((item) => item.id === f.planId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const eligibleEmployeeChoices = employees.filter(
    (employee) => employee.status === "Active" && employee.employmentStatus?.toLowerCase() !== "resigned" && !hasOpenHmoEnrollment(employee.id, enrollments),
  );
  const selectedEmployee = eligibleEmployeeChoices.find((employee) => employee.id === f.employeeId);
  const eligibilityDate = selectedEmployee ? hmoEligibilityDate(selectedEmployee.dateHired) : null;
  const eligibleForEffectiveDate = Boolean(selectedEmployee && isHmoEmployeeEligible(selectedEmployee, f.effective));
  const withinPlanDates = Boolean(plan && f.effective >= plan.coverageStart && f.effective <= plan.coverageEnd);
  const validExpiration = !f.expiration || Boolean(plan && f.expiration >= f.effective && f.expiration <= plan.coverageEnd);
  const save = async () => {
    if (!f.employeeId || !plan || !eligibleForEffectiveDate || !withinPlanDates || !validExpiration || saving) return;
    setSaving(true);
    setError("");
    try {
      await hmoService.createEnrollment({
        planId: plan.id,
        employeeId: f.employeeId,
        effectiveDate: f.effective,
        expirationDate: f.expiration || null,
        status: "Submitted",
      });
      recordAudit({
        action: "Submitted HMO enrollment",
        module: "HMO & Benefits",
        description: `Submitted HMO enrollment for employee ${f.employeeId}.`,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The HMO enrollment could not be submitted.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Enroll Employee" onClose={onClose}>
      <div className="grid gap-4">
        <Field label="Plan">
          <select
            className={input}
            value={f.planId}
            onChange={(e) => {
              const next = plans.find((item) => item.id === e.target.value);
              const employee = eligibleEmployeeChoices.find((item) => item.id === f.employeeId);
              const eligibility = employee ? hmoEligibilityDate(employee.dateHired) : null;
              const effective = [today(), next?.coverageStart ?? "", eligibility ?? ""].filter(Boolean).sort().slice(-1)[0] ?? today();
              setF({ ...f, planId: e.target.value, effective, expiration: next?.coverageEnd ?? "" });
              setError("");
            }}
          >
            <option value="">Select plan</option>
            {plans.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Employee">
          <select
            className={input}
            value={f.employeeId}
            onChange={(e) => {
              const employeeId = e.target.value;
              const employee = eligibleEmployeeChoices.find((item) => item.id === employeeId);
              const eligibility = employee ? hmoEligibilityDate(employee.dateHired) : null;
              const earliest = [today(), plan?.coverageStart ?? "", eligibility ?? ""].filter(Boolean).sort().slice(-1)[0] ?? today();
              setF({ ...f, employeeId, effective: earliest });
              setError("");
            }}
          >
            <option value="">Select employee</option>
            {eligibleEmployeeChoices.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.employeeNo})
                </option>
              ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Eligibility Date">
            <TextInput value={eligibilityDate ?? "Unavailable — hire date required"} readOnly />
          </Field>
          <Field label="Effective Date">
            <TextInput
              type="date"
              min={eligibilityDate ?? plan?.coverageStart}
              max={plan?.coverageEnd}
              value={f.effective}
              onChange={(e) => { setF({ ...f, effective: e.target.value }); setError(""); }}
            />
          </Field>
        </div>
        {selectedEmployee && !eligibilityDate && <p role="alert" className="text-[12px] text-amber-800">This employee record has no valid hire date. Update the employee record before submitting enrollment.</p>}
        {selectedEmployee && eligibilityDate && !eligibleForEffectiveDate && <p role="alert" className="text-[12px] text-amber-800">The employee becomes eligible on {formatHmoDate(eligibilityDate)} after completing the six-month waiting period.</p>}
        {plan && !withinPlanDates && <p role="alert" className="text-[12px] text-amber-800">The effective date must fall within the active plan coverage period ({formatHmoDate(plan.coverageStart)} – {formatHmoDate(plan.coverageEnd)}).</p>}
        <Field label="Expiration Date">
          <TextInput
            type="date"
            min={f.effective}
            max={plan?.coverageEnd}
            value={f.expiration}
            onChange={(e) => { setF({ ...f, expiration: e.target.value }); setError(""); }}
          />
        </Field>
        {!validExpiration && <p role="alert" className="text-[12px] text-amber-800">Expiration must be on or after the effective date and within the plan coverage period.</p>}
        <p className="text-[12px] text-[#6b7794]">
          Enrollment is submitted for HR approval. Maxicare confirmation is required before it becomes Active.
        </p>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-800">{error}</div>}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className={ghost} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <Button disabled={saving || !f.employeeId || !plan || !eligibleForEffectiveDate || !withinPlanDates || !validExpiration} onClick={() => void save()}>
          {saving ? "Submitting…" : "Submit Enrollment"}
        </Button>
      </div>
    </Modal>
  );
}
function DependentModal({
  enrollments,
  employeeMap,
  onClose,
  onSaved,
}: {
  enrollments: HmoEnrollment[];
  employeeMap: Map<string, Employee>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    enrollmentId: "",
    name: "",
    relationship: "Spouse",
    dob: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedEnrollment = enrollments.find((e) => e.id === f.enrollmentId);
  const effectiveDate = selectedEnrollment?.effectiveDate ?? "";
  const save = async () => {
    const name = f.name.trim();
    if (!f.enrollmentId || !name || !effectiveDate || saving) return;
    if (f.dob && f.dob > today()) {
      setError("Date of birth cannot be in the future.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await hmoService.createDependent({
        enrollmentId: f.enrollmentId,
        name,
        relationship: f.relationship,
        dateOfBirth: f.dob || null,
        eligibilityStatus: "Pending",
        effectiveDate,
        status: "Pending",
      });
      recordAudit({
        action: "Submitted dependent",
        module: "HMO & Benefits",
        description: `Submitted dependent ${name} for HMO coverage.`,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The dependent could not be submitted.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Add Dependent" onClose={onClose}>
      <div className="grid gap-4">
        <Field label="Employee">
          <select
            className={input}
            value={f.enrollmentId}
            onChange={(e) => {
              setF({ ...f, enrollmentId: e.target.value });
              setError("");
            }}
          >
            <option value="">Select employee</option>
            {enrollments.map((e) => (
              <option key={e.id} value={e.id}>
                {employeeMap.get(e.employeeId)?.name ?? e.employeeId}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dependent Name">
          <TextInput
            value={f.name}
            onChange={(e) => {
              setF({ ...f, name: e.target.value });
              setError("");
            }}
          />
        </Field>
        <Field label="Relationship">
          <select
            className={input}
            value={f.relationship}
            onChange={(e) => setF({ ...f, relationship: e.target.value })}
          >
            <option>Spouse</option>
            <option>Child</option>
          </select>
        </Field>
        <Field label="Date of Birth">
          <TextInput
            type="date"
            max={today()}
            value={f.dob}
            onChange={(e) => {
              setF({ ...f, dob: e.target.value });
              setError("");
            }}
          />
        </Field>
        <Field label="Coverage Effective Date">
          <TextInput type="date" value={effectiveDate} readOnly />
        </Field>
        <p className="text-[12px] text-[#6b7794]">
          Coverage starts with the employee&apos;s active HMO enrollment. Only a
          spouse or child can be submitted as an eligible dependent.
        </p>
        {error && <ErrorAlert>{error}</ErrorAlert>}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className={ghost} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <Button disabled={saving || !f.enrollmentId || !f.name.trim() || !effectiveDate} onClick={() => void save()}>
          {saving ? "Submitting…" : "Submit Dependent"}
        </Button>
      </div>
    </Modal>
  );
}
function HmoRecordsSection({
  enrollments,
  plans,
  dependents,
  employeeMap,
  onChanged,
}: {
  enrollments: HmoEnrollment[];
  plans: HmoPlan[];
  dependents: HmoDependent[];
  employeeMap: Map<string, Employee>;
  onChanged: () => void;
}) {
  const [selectedEnrollment, setSelectedEnrollment] = useState<HmoEnrollment | null>(null);
  const rows = enrollments.map((enrollment) => {
    const employee = employeeMap.get(enrollment.employeeId);
    const plan = plans.find((item) => item.id === enrollment.planId);
    const coveredDependents = dependents.filter((item) => item.enrollmentId === enrollment.id);
    const activeDependents = coveredDependents.filter(
      (item) =>
        item.status === "Active" &&
        item.approvalStatus === "Approved" &&
        item.maxicareStatus === "Active",
    );
    const companyShare =
      (Number(plan?.employeeMonthlyPremium ?? 0) * Number(plan?.employeeCompanyShare ?? 0)) / 100 +
      activeDependents.reduce((sum, item) => sum + Number(item.companyShare ?? 0), 0);
    const employeeShare =
      (Number(plan?.employeeMonthlyPremium ?? 0) * Number(plan?.employeeMemberShare ?? 0)) / 100 +
      activeDependents.reduce((sum, item) => sum + Number(item.employeeShare ?? 0), 0);
    return {
      enrollment,
      employee,
      plan,
      dependents: coveredDependents,
      companyShare: Math.round(companyShare * 100) / 100,
      employeeShare: Math.round(employeeShare * 100) / 100,
    };
  });
  const exportPdf = () => {
    const document = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    document.setFontSize(16);
    document.setTextColor(20, 43, 80);
    document.text("HMO Summary Report", 14, 16);
    document.setFontSize(9);
    document.setTextColor(100, 119, 150);
    document.text(`Generated ${new Date().toLocaleString("en-PH")}`, 14, 22);
    autoTable(document, {
      startY: 28,
      head: [[
        "Employee",
        "Department",
        "HMO Plan",
        "Coverage Period",
        "Dependents",
        "Company Share",
        "Employee Share",
        "Enrollment Status",
      ]],
      body: rows.map((row) => [
        row.employee?.name ?? row.enrollment.employeeId,
        row.employee?.department ?? "Unavailable",
        row.plan?.name ?? "Unavailable",
        `${formatHmoDate(row.enrollment.effectiveDate)} – ${formatHmoDate(row.enrollment.expirationDate)}`,
        row.dependents.length ? row.dependents.map((item) => item.name).join(", ") : "None",
        money(row.companyShare),
        money(row.employeeShare),
        enrollmentDisplayStatus(row.enrollment),
      ]),
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 2, textColor: [20, 43, 80] },
      headStyles: { fillColor: [23, 52, 91], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 248, 252] },
      margin: { left: 14, right: 14 },
    });
    document.save(`hmo-summary-${new Date().toISOString().slice(0, 10)}.pdf`);
  };
  return (
    <Card className="hmo-records-report mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[16px] font-semibold">HMO Records</h2>
          <p className="mt-1 text-[12px] text-[#6b7794]">
            Accurate employee enrollment summary, coverage, dependents, and contribution shares.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button onClick={exportPdf}>Export PDF</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="mt-4"><Empty>No HMO records found.</Empty></div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1250px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#e3e7ef] text-[11px] uppercase tracking-wide text-[#6b7794]">
                {[
                  "Employee",
                  "Department",
                  "HMO Plan",
                  "Coverage Period",
                  "Dependents",
                  "Company Share",
                  "Employee Share",
                  "Enrollment Status",
                  "Action",
                ].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.enrollment.id} className="border-b border-[#eef1f6]">
                  <td className="px-3 py-3 font-semibold">{row.employee?.name ?? row.enrollment.employeeId}</td>
                  <td className="px-3 py-3">{row.employee?.department ?? "Unavailable"}</td>
                  <td className="px-3 py-3">{row.plan?.name ?? "Unavailable"}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatHmoDate(row.enrollment.effectiveDate)} – {formatHmoDate(row.enrollment.expirationDate)}</td>
                  <td className="px-3 py-3">{row.dependents.length ? row.dependents.map((item) => item.name).join(", ") : "None"}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{money(row.companyShare)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{money(row.employeeShare)}</td>
                  <td className="px-3 py-3"><StatusBadge status={enrollmentDisplayStatus(row.enrollment)}/></td>
                  <td className="px-3 py-3"><button type="button" className="font-semibold text-blue-600 hover:text-blue-800 print:hidden" onClick={() => setSelectedEnrollment(row.enrollment)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedEnrollment && (
        <EnrollmentViewModal
          enrollment={selectedEnrollment}
          employee={employeeMap.get(selectedEnrollment.employeeId)}
          plan={plans.find((item) => item.id === selectedEnrollment.planId)}
          onClose={() => setSelectedEnrollment(null)}
          onChanged={() => { setSelectedEnrollment(null); onChanged(); }}
        />
      )}
    </Card>
  );
}
