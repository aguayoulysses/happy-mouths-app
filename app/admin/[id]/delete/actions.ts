"use server";

import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { all, one, run, logEvent } from "@/lib/db";

// Removes a business and every row in any table that points at it. No soft delete, no undo.
// The owner's own in-app delete (app/api/v1/account) does the same with a fixed table list;
// this one reads the tables from the schema so new ones are never missed.
export async function deleteClient(form: FormData) {
  if (!(await isAdmin())) redirect("/admin/login");
  const id = Number(form.get("id"));
  const typed = String(form.get("confirm") ?? "").trim().toLowerCase();
  const b = await one<{ id: number; name: string }>("SELECT id, name FROM businesses WHERE id=?", [id]);
  if (!b) redirect("/admin/clients");
  if (typed !== b.name.trim().toLowerCase()) redirect(`/admin/${id}/delete?error=1`);

  const tables = await all<{ name: string }>(
    "SELECT m.name FROM sqlite_master m WHERE m.type='table' AND m.name <> 'businesses' AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) p WHERE p.name='business_id')"
  );
  for (const t of tables) await run(`DELETE FROM "${t.name}" WHERE business_id=?`, [id]);
  await run("DELETE FROM businesses WHERE id=?", [id]);
  await logEvent(0, "client_deleted", `${b.name} (#${id}) deleted from ops`).catch(() => 0);
  redirect("/admin/clients?deleted=" + encodeURIComponent(b.name));
}
