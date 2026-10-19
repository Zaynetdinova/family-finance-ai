-- 0003_seed_categories.sql
-- System categories (household_id IS NULL). Idempotent.
-- is_fixed = true marks recurring/obligatory spend used for the fixed-vs-variable split.

insert into categories (name, kind, is_fixed, is_system) values
  ('Жильё и коммунальные услуги', 'expense', true,  true),
  ('Ипотека и кредиты',           'expense', true,  true),
  ('Продукты',                    'expense', false, true),
  ('Кафе и рестораны',            'expense', false, true),
  ('Транспорт',                   'expense', false, true),
  ('Здоровье',                    'expense', false, true),
  ('Дети',                        'expense', false, true),
  ('Одежда и покупки',            'expense', false, true),
  ('Подписки',                    'expense', true,  true),
  ('Развлечения',                 'expense', false, true),
  ('Путешествия',                 'expense', false, true),
  ('Образование',                 'expense', false, true),
  ('Налоги и комиссии',           'expense', true,  true),
  ('Подарки',                     'expense', false, true),
  ('Прочее',                      'expense', false, true),
  ('Зарплата',                    'income',  false, true),
  ('Фриланс и бизнес',            'income',  false, true),
  ('Аренда',                      'income',  false, true),
  ('Инвестиции',                  'income',  false, true),
  ('Возвраты',                    'income',  false, true),
  ('Прочие доходы',               'income',  false, true)
on conflict do nothing;

-- A few common subcategories
insert into categories (name, kind, is_fixed, is_system, parent_id)
select s.name, 'expense', p.is_fixed, true, p.id
from (values
  ('Жильё и коммунальные услуги', 'Аренда жилья'),
  ('Жильё и коммунальные услуги', 'Электричество, вода, газ'),
  ('Жильё и коммунальные услуги', 'Интернет и связь'),
  ('Ипотека и кредиты',           'Проценты'),
  ('Транспорт',                   'Такси'),
  ('Транспорт',                   'Топливо'),
  ('Транспорт',                   'Общественный транспорт'),
  ('Здоровье',                    'Аптека'),
  ('Здоровье',                    'Врачи')
) as s(parent, name)
join categories p on p.name = s.parent and p.is_system and p.parent_id is null and p.kind = 'expense'
on conflict do nothing;
