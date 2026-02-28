declare module "bun:sqlite" {
  export class Database {
    constructor(
      filename: string,
      options?: { create?: boolean; readwrite?: boolean; readonly?: boolean },
    );
    exec(sql: string): void;
    prepare(sql: string): Statement;
    query(sql: string): Statement;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    close(): void;
  }

  interface Statement {
    all(...params: any[]): any[];
    get(...params: any[]): any;
    run(
      ...params: any[]
    ): { changes: number; lastInsertRowid: number | bigint };
  }
}
