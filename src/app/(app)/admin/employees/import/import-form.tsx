"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Notice, Table } from "@/components/ui";
import { importEmployeesAction } from "../../actions";

export function ImportForm() {
  const t = useTranslations("admin.import");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState(importEmployeesAction, undefined);
  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" aria-label={t("file")} />
        <Button type="submit" disabled={pending}>
          {pending ? t("importing") : t("submit")}
        </Button>
      </form>
      {state?.ok === false && state.code && <Notice tone="error">{te.has(state.code) ? te(state.code) : te("UNEXPECTED")}</Notice>}
      {state?.ok === false && state.errors && (
        <>
          <Notice tone="error">{t("hasErrors", { count: state.errors.length })}</Notice>
          <Table>
            <thead>
              <tr>
                <th>{t("row")}</th>
                <th>{t("column")}</th>
                <th>{t("problem")}</th>
              </tr>
            </thead>
            <tbody>
              {state.errors.map((e, i) => (
                <tr key={i}>
                  <td className="tabular">{e.row}</td>
                  <td>{e.field}</td>
                  <td>{te.has(e.code) ? te(e.code) : e.code}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      {state?.ok && (
        <>
          <Notice tone="success">{t("done", { count: state.created.length })}</Notice>
          <Table>
            <thead>
              <tr>
                <th>{t("code")}</th>
                <th>{t("email")}</th>
                <th>{t("tempPassword")}</th>
              </tr>
            </thead>
            <tbody>
              {state.created.map((c) => (
                <tr key={c.employeeCode}>
                  <td>{c.employeeCode}</td>
                  <td>{c.email}</td>
                  <td className="tabular font-medium">{c.tempPassword}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
