import { fail } from "./domain.mjs";
export class Database {
  constructor(binding) {
    this.binding = binding;
    this.queries = 0;
  }
  stmt(sql, params = []) {
    if (++this.queries > 45)
      fail(503, "QUERY_BUDGET", "Повторите запрос позже.");
    return this.binding.prepare(sql).bind(...params);
  }
  async all(sql, p = []) {
    return (await this.stmt(sql, p).all()).results;
  }
  first(sql, p = []) {
    return this.stmt(sql, p).first();
  }
  run(sql, p = []) {
    return this.stmt(sql, p).run();
  }
  async atomic(predicate, params, statements) {
    const id = crypto.randomUUID();
    try {
      return await this.binding.batch([
        this.stmt(
          `INSERT INTO mutation_guards(id,ok) VALUES(?,CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`,
          [id, ...params],
        ),
        ...statements.map(([s, p]) => this.stmt(s, p)),
        this.stmt("DELETE FROM mutation_guards WHERE id=?", [id]),
      ]);
    } catch (e) {
      if (String(e).includes("mutation_precondition"))
        fail(
          409,
          "STALE_ORDER",
          "Данные изменились. Обновите карточку и повторите действие.",
        );
      throw e;
    }
  }
}
