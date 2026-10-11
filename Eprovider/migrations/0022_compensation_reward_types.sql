-- Extend compensation rewards for allowances and adjustment entries.
alter table compensation_rewards drop constraint if exists compensation_rewards_reward_type_check;
alter table compensation_rewards add constraint compensation_rewards_reward_type_check
  check (reward_type in ('Bonus','Incentive','Allowance','Adjustment'));
