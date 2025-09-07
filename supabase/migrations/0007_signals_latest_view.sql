create or replace view signals_latest as
select * from (
  select s.*,
         row_number() over (
           partition by coalesce(s.asset, ''), coalesce(s.structure, '')
           order by coalesce(s.updated_at, s.created_at) desc
         ) as rn
  from signals s
) x
where rn = 1;


