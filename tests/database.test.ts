// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { sampleDocument } from '../src/lib/fixture';
let pg: PGlite;
const ownerA = '00000000-0000-4000-8000-000000000001',
  ownerB = '00000000-0000-4000-8000-000000000002';
const doc = sampleDocument(ownerA);
doc.revision = 1;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
    create table auth.users(id uuid primary key); insert into auth.users values ('${ownerA}'),('${ownerB}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth,storage to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1, '/')$$;
    alter table storage.objects enable row level security; grant select,insert,update,delete on storage.objects to authenticated; grant select on storage.objects to anon;`);
  const sql = await readFile(
    new URL('../supabase/migrations/202610110001_tripflow.sql', import.meta.url),
    'utf8'
  );
  await pg.exec(sql);
}, 60000);
afterAll(async () => {
  await pg?.close();
});
async function asUser(id: string, role = 'authenticated') {
  await pg.exec(
    `reset role; set role ${role}; select set_config('request.jwt.claim.sub', '${id}', false);`
  );
}
it('runs migration in actual PostgreSQL and isolates private trips between accounts', async () => {
  await asUser(ownerA);
  await pg.query('insert into public.trips(id,owner_id,data,revision) values($1,$2,$3,1)', [
    doc.trip.id,
    ownerA,
    JSON.stringify(doc),
  ]);
  expect((await pg.query('select * from public.trips')).rows).toHaveLength(1);
  await asUser(ownerB);
  expect((await pg.query('select * from public.trips')).rows).toHaveLength(0);
  await expect(
    pg.query('insert into public.trips(id,owner_id,data,revision) values($1,$2,$3,1)', [
      crypto.randomUUID(),
      ownerA,
      JSON.stringify(doc),
    ])
  ).rejects.toThrow();
  await asUser('', 'anon');
  await expect(pg.query('select * from public.trips')).rejects.toThrow();
});
it('enforces optimistic revision updates and immutable ownership', async () => {
  await asUser(ownerA);
  const next = { ...doc, revision: 2 };
  expect(
    (
      await pg.query(
        'update public.trips set data=$1,revision=2 where id=$2 and revision=1 returning id',
        [JSON.stringify(next), doc.trip.id]
      )
    ).rows
  ).toHaveLength(1);
  expect(
    (
      await pg.query(
        'update public.trips set data=$1,revision=2 where id=$2 and revision=1 returning id',
        [JSON.stringify(next), doc.trip.id]
      )
    ).rows
  ).toHaveLength(0);
  await expect(
    pg.query('update public.trips set owner_id=$1,revision=3 where id=$2', [ownerB, doc.trip.id])
  ).rejects.toThrow();
});
it('protects private photo objects against other users and anonymous access', async () => {
  const path = `${ownerA}/${doc.trip.id}/${crypto.randomUUID()}`;
  await asUser(ownerA);
  await pg.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
    'tripflow-photos',
    path,
  ]);
  expect((await pg.query('select * from storage.objects')).rows).toHaveLength(1);
  await asUser(ownerB);
  expect((await pg.query('select * from storage.objects')).rows).toHaveLength(0);
  await expect(
    pg.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['tripflow-photos', path])
  ).rejects.toThrow();
  expect((await pg.query('delete from storage.objects returning id')).rows).toHaveLength(0);
  await asUser('', 'anon');
  expect((await pg.query('select * from storage.objects')).rows).toHaveLength(0);
});
