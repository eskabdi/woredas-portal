import { vi } from "vitest";

// A minimal stand-in for the PostgREST query builder. Every chain method
// (`.eq()`, `.select()`, `.upsert()`, ...) returns the same builder so calls
// can be chained in any order the real client allows, and the builder itself
// is thenable so `await supabase.from(...).update(...).eq(...)` resolves
// without an explicit terminal call — matching how supabase-js's builders
// work (they execute on `await`/`.then()`, not on a dedicated "run" method).
export interface QueryBuilderMock extends PromiseLike<{ data: unknown; error: unknown }> {
  eq: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  resolveWith: (value: { data: unknown; error: unknown }) => QueryBuilderMock;
}

export function createQueryBuilderMock(
  initial: { data: unknown; error: unknown } = { data: null, error: null },
): QueryBuilderMock {
  let resolved = initial;

  const builder = {
    eq: vi.fn(() => builder),
    update: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    single: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    in: vi.fn(() => builder),
    is: vi.fn(() => builder),
    resolveWith(value: { data: unknown; error: unknown }) {
      resolved = value;
      return builder;
    },
    then(onFulfilled: (value: { data: unknown; error: unknown }) => unknown, onRejected?: unknown) {
      return Promise.resolve(resolved).then(onFulfilled, onRejected as never);
    },
  } as QueryBuilderMock;

  return builder;
}

export function createSupabaseMock() {
  const fromMock = vi.fn();
  const invokeMock = vi.fn();
  const rpcMock = vi.fn();

  return {
    from: fromMock,
    functions: { invoke: invokeMock },
    rpc: rpcMock,
  };
}
