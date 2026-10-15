-- Allowances (type, frequency, active/inactive) and incentives & bonuses (cutoff, reason,
-- taxable, pending/approved/rejected) share compensation_rewards.
alter table compensation_rewards add column if not exists allowance_type text not null default '';
alter table compensation_rewards add column if not exists frequency text not null default 'Monthly';
alter table compensation_rewards add column if not exists taxable boolean not null default true;
alter table compensation_rewards add column if not exists cutoff_start date;
alter table compensation_rewards add column if not exists cutoff_end date;
alter table compensation_rewards add column if not exists updated_at timestamptz;

alter table compensation_rewards drop constraint if exists compensation_rewards_status_check;
alter table compensation_rewards drop constraint if exists compensation_rewards_reward_type_check;

-- Existing allowance and adjustment entries become allowances of that type.
update compensation_rewards set allowance_type=reward_type
  where reward_type in ('Allowance','Adjustment') and allowance_type='';
update compensation_rewards set status=case when status='Approved' then 'Active' else 'Inactive' end
  where reward_type in ('Allowance','Adjustment') and status not in ('Active','Inactive');
update compensation_rewards set reward_type='Allowance' where reward_type='Adjustment';

-- Existing bonuses and incentives are assigned to the cutoff containing their effective date.
update compensation_rewards set status='Pending' where reward_type in ('Bonus','Incentive') and status='Planned';
update compensation_rewards set
  cutoff_start=case when extract(day from effective_date)<=15 then date_trunc('month',effective_date)::date
                    else (date_trunc('month',effective_date)+interval '15 days')::date end,
  cutoff_end=case when extract(day from effective_date)<=15 then (date_trunc('month',effective_date)+interval '14 days')::date
                  else (date_trunc('month',effective_date)+interval '1 month'-interval '1 day')::date end
  where reward_type in ('Bonus','Incentive') and cutoff_start is null;

alter table compensation_rewards add constraint compensation_rewards_reward_type_check
  check (reward_type in ('Bonus','Incentive','Allowance'));
alter table compensation_rewards add constraint compensation_rewards_status_check
  check (status in ('Pending','Approved','Rejected','Active','Inactive'));
alter table compensation_rewards drop constraint if exists compensation_rewards_frequency_check;
alter table compensation_rewards add constraint compensation_rewards_frequency_check
  check (frequency in ('Per Cutoff','Monthly'));
