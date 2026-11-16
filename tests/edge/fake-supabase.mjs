// Faux supabase-js en mémoire : juste ce dont les fonctions edge
// Lovense se servent (filtres eq / not null, tri, upsert…).
export const db = { tables: {}, user: null, failTables: new Set() };

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.op = "select";
  }
  get rows() {
    return (db.tables[this.table] ||= []);
  }
  select() { this.returning = true; return this; }
  insert(row) { this.op = "insert"; this.payload = row; return this; }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  upsert(row, { onConflict } = {}) {
    this.op = "upsert"; this.payload = row; this.conflict = (onConflict || "").split(","); return this;
  }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  not(column, _is, _value) { this.filters.push((row) => row[column] != null); return this; }
  order(column, { ascending = true } = {}) { this.sort = [column, ascending]; return this; }
  limit(count) { this.max = count; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }

  run() {
    if (db.failTables.has(this.table)) {
      return { data: null, error: { message: `relation "${this.table}" does not exist`, code: "42P01" } };
    }
    const match = (row) => this.filters.every((test) => test(row));
    let out = [];
    if (this.op === "select") {
      out = this.rows.filter(match);
      if (this.sort) {
        const [column, ascending] = this.sort;
        out = [...out].sort((a, b) => (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1));
      }
      if (this.max) out = out.slice(0, this.max);
    } else if (this.op === "insert") {
      const unique = db.unique?.[this.table];
      if (unique && this.rows.some((row) => unique.every((c) => row[c] === this.payload[c]))) {
        return { data: null, error: { message: "duplicate key", code: "23505" } };
      }
      const row = { id: this.rows.length + 1, ...this.payload };
      this.rows.push(row);
      out = [row];
    } else if (this.op === "upsert") {
      const found = this.rows.find((row) => this.conflict.every((c) => row[c] === this.payload[c]));
      if (found) Object.assign(found, this.payload);
      else this.rows.push({ ...this.payload });
      out = [found || this.rows.at(-1)];
    } else if (this.op === "update") {
      out = this.rows.filter(match);
      out.forEach((row) => Object.assign(row, this.payload));
    } else if (this.op === "delete") {
      out = this.rows.filter(match);
      db.tables[this.table] = this.rows.filter((row) => !match(row));
    }
    return { data: this.one ? out[0] ?? null : out, error: null };
  }
  then(resolve, reject) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

export function createClient() {
  return {
    auth: { getUser: async () => ({ data: { user: db.user }, error: db.user ? null : { message: "no" } }) },
    from: (table) => new Query(table),
  };
}
