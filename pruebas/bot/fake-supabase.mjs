// Cliente de Supabase falso para pruebas: traduce las llamadas a SQL y las corre con psql en la base local.
import { execFileSync } from "node:child_process";
const PSQL = ["-h", "localhost", "-U", "postgres", "-d", process.env.PGDB || "cil", "-At", "-v", "ON_ERROR_STOP=1", "-q"];
const lit = (v) => v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v)
  : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
export function sql(q) {
  try { return { out: execFileSync("psql", [...PSQL, "-c", q], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "prueba" } }).trim() }; }
  catch (e) { return { error: { message: String(e.stderr || e.message).slice(0, 300) } }; }
}
class Q {
  constructor(t) { this.t = t; this.w = []; this.op = "select"; this.cols = "*"; }
  select(cols = "*", o = {}) { if (this.op === "insert") { this.ret = cols; return this; } this.cols = cols; this.head = o.head; this.count = o.count; return this; }
  insert(row) { this.op = "insert"; this.row = row; return this; }
  eq(c, v) { this.w.push(`${c} = ${lit(v)}`); return this; }
  gt(c, v) { this.w.push(`${c} > ${lit(v)}`); return this; }
  gte(c, v) { this.w.push(`${c} >= ${lit(v)}`); return this; }
  order(c, o = {}) { this.ord = `${c} ${o.ascending === false ? "desc" : "asc"}`; return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  then(ok, ko) { return Promise.resolve(this.run()).then(ok, ko); }
  run() {
    const where = this.w.length ? " where " + this.w.join(" and ") : "";
    if (this.op === "insert") {
      const ks = Object.keys(this.row);
      const r = sql(`with x as (insert into ${this.t} (${ks.join(",")}) values (${ks.map((k) => lit(this.row[k])).join(",")}) returning ${this.ret || "id"}) select row_to_json(x) from x`);
      if (r.error) return { data: null, error: r.error };
      return { data: this.one ? JSON.parse(r.out) : [JSON.parse(r.out)], error: null };
    }
    if (this.head) { const r = sql(`select count(*) from ${this.t}${where}`); return { count: Number(r.out), data: null, error: r.error ?? null }; }
    const r = sql(`select coalesce(json_agg(z), '[]') from (select ${this.cols} from ${this.t}${where}${this.ord ? " order by " + this.ord : ""}${this.lim ? " limit " + this.lim : ""}) z`);
    if (r.error) return { data: null, error: r.error };
    const rows = JSON.parse(r.out);
    if (this.one) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}
export function createClient() {
  return {
    from: (t) => new Q(t),
    rpc: async (fn, args) => {
      const r = sql(`select to_json(${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ")}))`);
      return r.error ? { data: null, error: r.error } : { data: r.out ? JSON.parse(r.out) : null, error: null };
    },
  };
}
