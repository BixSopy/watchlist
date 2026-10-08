-- Tests de la migration 20261008120000_mark_watched_fiable.sql (extension navigateur) sur Postgres local.
-- Chaque assertion lève une exception en cas d'échec (psql -v ON_ERROR_STOP=1).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ÉCHEC : %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
-- Raccourci : statut renvoyé par mark_watched_by_title (appel en anon, comme l'extension)
create or replace function pg_temp.st(p jsonb) returns text language sql as $$ select p ->> 'status' $$;
set client_min_messages = notice;

-- ---------- Normalisation ----------
select pg_temp.check(public.normalize_title_for_match('The Office') = 'office', 'article anglais retiré');
select pg_temp.check(public.normalize_title_for_match('L’Odyssée (2021)') = 'odyssee', 'apostrophe typographique, accent, article l'' et année entre parenthèses');
select pg_temp.check(public.normalize_title_for_match('Les Misérables [1998]') = 'miserables', 'article les, année entre crochets');
select pg_temp.check(public.normalize_title_for_match('ÉLITE') = 'elite', 'majuscules accentuées');
select pg_temp.check(public.normalize_title_for_match('Spider-Man: No Way Home') = 'spider man no way home', 'ponctuation -> espace');
select pg_temp.check(public.normalize_title_for_match('  Ça   !! ') = 'ca', 'espaces multiples, cédille');
select pg_temp.check(public.normalize_title_for_match('Œdipe & Æther') = 'oedipe aether', 'ligatures');
select pg_temp.check(public.normalize_title_for_match('1917') = '1917', 'titre-année conservé');
select pg_temp.check(public.normalize_title_for_match('Blade Runner 2049') = 'blade runner 2049', 'année nue conservée');
select pg_temp.check(public.normalize_title_for_match('Les') = 'les', 'titre réduit à un article : conservé');
select pg_temp.check(public.normalize_title_for_match('Lesbos') = 'lesbos', 'pas de coupe au milieu d''un mot');
select pg_temp.check(public.normalize_title_for_match('進撃の巨人') = '進撃の巨人', 'écritures non latines conservées');
select pg_temp.check(public.normalize_title_for_match('%') is null and public.normalize_title_for_match('') is null
  and public.normalize_title_for_match(null) is null, 'titre vide ou ponctuation seule -> null');

-- ---------- Droits et durcissement ----------
select pg_temp.check(not has_function_privilege('anon', 'public.normalize_title_for_match(text)', 'execute'), 'anon ne peut pas appeler normalize_title_for_match');
select pg_temp.check(has_function_privilege('anon', 'public.mark_watched_by_title(text,text,integer,integer,text)', 'execute'), 'anon peut appeler mark_watched_by_title (jeton)');
select pg_temp.check(not exists (select 1 from pg_proc where proname = 'mark_watched_by_title' and pronargs = 4), 'ancienne signature à 4 paramètres supprimée');
select pg_temp.check((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where proname = 'mark_watched_by_title'), 'SECURITY DEFINER + search_path figé');
select pg_temp.check(not exists (select 1 from pg_proc where proname = 'mark_watched_by_title' and prosrc ilike '%like%'), 'aucun LIKE (plus de correspondance partielle)');

-- ---------- Données ----------
insert into auth.users (id, email, email_confirmed_at) values
  ('55555555-5555-5555-5555-555555555555', 'c@exemple.fr', now()),
  ('66666666-6666-6666-6666-666666666666', 'd@exemple.fr', now());
insert into public.profiles (id, account_id, name, plex_webhook_token) values
  ('eeeeeeee-0000-0000-0000-000000000005', '55555555-5555-5555-5555-555555555555', 'C', repeat('ef', 24)),
  ('ffffffff-0000-0000-0000-000000000006', '66666666-6666-6666-6666-666666666666', 'D', repeat('12', 24));
insert into public.watchlist_items (local_id, profile_id, type, title, status, saison, episode, deleted) values
  ('dark',    'eeeeeeee-0000-0000-0000-000000000005', 'serie', 'Dark',                 'encours', 1, 2,    false),
  ('darkf',   'eeeeeeee-0000-0000-0000-000000000005', 'film',  'Dark',                 'avoir',   null, null, false),
  ('up',      'eeeeeeee-0000-0000-0000-000000000005', 'film',  'Up',                   'avoir',   null, null, false),
  ('upload',  'eeeeeeee-0000-0000-0000-000000000005', 'serie', 'Upload',               'avoir',   null, null, false),
  ('you',     'eeeeeeee-0000-0000-0000-000000000005', 'serie', 'You',                  'avoir',   null, null, false),
  ('matrix',  'eeeeeeee-0000-0000-0000-000000000005', 'film',  'Matrix',               'avoir',   null, null, false),
  ('lupin1',  'eeeeeeee-0000-0000-0000-000000000005', 'serie', 'Lupin',                'avoir',   null, null, false),
  ('lupin2',  'eeeeeeee-0000-0000-0000-000000000005', 'anime', 'Lupin',                'avoir',   null, null, false),
  ('titans',  'eeeeeeee-0000-0000-0000-000000000005', 'anime', 'L''Attaque des Titans', 'todo',    null, null, false),
  ('elite',   'eeeeeeee-0000-0000-0000-000000000005', 'serie', 'Élite',                'avoir',   null, null, false),
  ('arcane',  'eeeeeeee-0000-0000-0000-000000000005', 'serie', 'Arcane',               'avoir',   1, 1,    false),
  ('sev',     'eeeeeeee-0000-0000-0000-000000000005', 'serie', 'Severance',            'avoir',   null, null, true),
  ('darkD',   'ffffffff-0000-0000-0000-000000000006', 'serie', 'Dark',                 'avoir',   null, null, false);

set role anon;
-- ---------- Jeton ----------
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('00', 24), 'Dark', 1, 3, 'episode')) = 'invalid_token', 'jeton inconnu -> invalid_token');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(null, 'Dark', 1, 3, 'episode')) = 'invalid_token', 'jeton absent -> invalid_token');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title('', 'Dark', 1, 3)) = 'invalid_token', 'jeton vide -> invalid_token');

-- ---------- Episode : mis à jour, puis déjà à jour, jamais en arrière ----------
select pg_temp.check(public.mark_watched_by_title(repeat('ef', 24), 'Dark', 1, 3, 'episode')
  = '{"status":"updated","title":"Dark","season":1,"episode":3}'::jsonb, 'Dark S1E3 -> updated (titre, saison, épisode renvoyés)');
select pg_temp.check(public.mark_watched_by_title(repeat('ef', 24), 'DARK', 1, 3, 'episode')
  = '{"status":"already_up_to_date","title":"Dark","season":1,"episode":3}'::jsonb, 'même épisode -> already_up_to_date');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Dark', 1, 1, 'episode')) = 'already_up_to_date', 'épisode antérieur -> already_up_to_date (pas de régression)');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Arcane', 1, 1, 'episode')) = 'updated', 'même épisode mais titre encore « à voir » -> passe « en cours »');

-- ---------- Plus de correspondance partielle ----------
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Grown Ups', null, null, 'movie')) = 'not_found', '« Grown Ups » ne touche pas le film « Up »');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Young Sheldon', 1, 1, 'episode')) = 'not_found', '« Young Sheldon » ne touche pas « You »');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Dark Matter', 1, 1, 'episode')) = 'not_found', '« Dark Matter » ne touche pas « Dark »');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Upload', 1, 1, 'episode')) = 'updated', '« Upload » met à jour la série Upload');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'D_rk', 1, 9, 'episode')) = 'not_found', '_ n''est plus un joker');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), '%', null, null, 'movie')) = 'invalid_input', '% seul -> invalid_input (aucun joker)');

-- ---------- Type vérifié ----------
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Matrix', 1, 1, 'episode')) = 'not_found', 'épisode : un film du même nom n''est jamais modifié');
select pg_temp.check(public.mark_watched_by_title(repeat('ef', 24), 'Matrix', null, null, 'movie')
  = '{"status":"updated","title":"Matrix","season":null,"episode":null}'::jsonb, 'film -> terminé');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Matrix', null, null, 'movie')) = 'already_up_to_date', 'film déjà terminé -> already_up_to_date');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Dark', null, null, 'movie')) = 'updated', 'film « Dark » : seul le film est terminé');

-- ---------- Ambiguïté ----------
select pg_temp.check(public.mark_watched_by_title(repeat('ef', 24), 'Lupin', 1, 1, 'episode')
  = '{"status":"ambiguous","title":"Lupin","season":1,"episode":1,"count":2}'::jsonb, 'deux titres « Lupin » -> ambiguous, avec le nombre');

-- ---------- Normalisation + compatibilité extension 0.3.0 (4 paramètres, sans type) ----------
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'ELITE', 2, 1)) = 'updated', 'appel sans p_type (0.3.0) + accents/casse');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'L’Attaque des Titans', 3, 4)) = 'updated', 'apostrophe typographique ; anime « à faire » -> en cours');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'You', null, null)) = 'not_found', 'sans p_type ni saison : traité comme un film (la série « You » n''est pas touchée)');

-- ---------- Entrées invalides ----------
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Dark', 1, 4, 'show')) = 'invalid_input', 'type inconnu -> invalid_input');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Dark', 1, 4, 'movie')) = 'invalid_input', 'film avec saison -> invalid_input');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Dark', null, 4, 'episode')) = 'invalid_input', 'épisode sans saison -> invalid_input');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), '', 1, 4, 'episode')) = 'invalid_input', 'titre vide -> invalid_input');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), repeat('x', 301), 1, 4, 'episode')) = 'invalid_input', 'titre trop long -> invalid_input');
select pg_temp.check(pg_temp.st(public.mark_watched_by_title(repeat('ef', 24), 'Severance', 1, 1, 'episode')) = 'not_found', 'titre supprimé -> not_found');
reset role;

-- ---------- Etat final de la base ----------
select pg_temp.check((select saison = 1 and episode = 3 and status = 'encours' from public.watchlist_items where local_id = 'dark'), 'Dark : S1E3, en cours');
select pg_temp.check((select status = 'termine' and saison is null from public.watchlist_items where local_id = 'darkf'), 'film Dark : terminé, sans saison');
select pg_temp.check((select status = 'avoir' and saison is null from public.watchlist_items where local_id = 'up'), 'film Up intact');
select pg_temp.check((select status = 'avoir' and saison is null from public.watchlist_items where local_id = 'you'), 'série You intacte');
select pg_temp.check((select count(*) = 2 from public.watchlist_items where local_id in ('lupin1', 'lupin2') and status = 'avoir' and saison is null), 'les deux Lupin intacts');
select pg_temp.check((select status = 'termine' from public.watchlist_items where local_id = 'matrix'), 'Matrix terminé');
select pg_temp.check((select saison = 3 and episode = 4 and status = 'encours' from public.watchlist_items where local_id = 'titans'), 'Attaque des Titans : S3E4, en cours');
select pg_temp.check((select saison = 2 and episode = 1 from public.watchlist_items where local_id = 'elite'), 'Élite : S2E1');
select pg_temp.check((select status = 'encours' and saison = 1 and episode = 1 from public.watchlist_items where local_id = 'arcane'), 'Arcane : en cours');
select pg_temp.check((select status = 'avoir' and saison is null from public.watchlist_items where local_id = 'darkD'), 'compte D intact (bornage au propriétaire du jeton)');
select pg_temp.check((select saison is null from public.watchlist_items where local_id = 'sev'), 'titre supprimé intact');

do $$ begin raise notice 'Tests 20_mark_watched_fiable passés.'; end $$;
