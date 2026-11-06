import { getTranslations } from "next-intl/server";
import { Field, Input, Select } from "@/components/ui";

interface Options {
  departments: { id: string; name: string }[];
  managers: { id: string; fullName: string; employeeCode: string }[];
  locations: { id: string; name: string }[];
}
interface Defaults {
  employeeCode?: string;
  fullName?: string;
  email?: string;
  role?: string;
  designation?: string | null;
  departmentId?: string | null;
  managerId?: string | null;
  officeLocationId?: string | null;
  joinedOn?: string | null;
  status?: string;
}

export async function EmployeeFields({ options, defaults = {}, mode, selfId }: { options: Options; defaults?: Defaults; mode: "create" | "edit"; selfId?: string }) {
  const t = await getTranslations("admin.employees");
  const tr = await getTranslations("shell.role");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("code")} htmlFor="employeeCode">
        <Input id="employeeCode" name="employeeCode" defaultValue={defaults.employeeCode} required disabled={mode === "edit"} maxLength={30} />
      </Field>
      <Field label={t("name")} htmlFor="fullName">
        <Input id="fullName" name="fullName" defaultValue={defaults.fullName} required maxLength={120} />
      </Field>
      <Field label={t("email")} htmlFor="email" hint={mode === "create" ? t("emailHint") : undefined}>
        <Input id="email" name="email" type="email" defaultValue={defaults.email} required disabled={mode === "edit"} />
      </Field>
      <Field label={t("designation")} htmlFor="designation">
        <Input id="designation" name="designation" defaultValue={defaults.designation ?? ""} maxLength={120} />
      </Field>
      <Field label={t("role")} htmlFor="role">
        <Select id="role" name="role" defaultValue={defaults.role ?? "EMPLOYEE"}>
          {(["EMPLOYEE", "MANAGER", "COMPANY_ADMIN"] as const).map((r) => (
            <option key={r} value={r}>
              {tr(r)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("manager")} htmlFor="managerId">
        <Select id="managerId" name="managerId" defaultValue={defaults.managerId ?? ""}>
          <option value="">{t("none")}</option>
          {options.managers
            .filter((m) => m.id !== selfId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName} ({m.employeeCode})
              </option>
            ))}
        </Select>
      </Field>
      <Field label={t("department")} htmlFor="departmentId">
        <Select id="departmentId" name="departmentId" defaultValue={defaults.departmentId ?? ""}>
          <option value="">{t("none")}</option>
          {options.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("location")} htmlFor="officeLocationId" hint={t("locationHint")}>
        <Select id="officeLocationId" name="officeLocationId" defaultValue={defaults.officeLocationId ?? ""}>
          <option value="">{t("anyLocation")}</option>
          {options.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("joinedOn")} htmlFor="joinedOn">
        <Input id="joinedOn" name="joinedOn" type="date" defaultValue={defaults.joinedOn ?? ""} />
      </Field>
      {mode === "edit" && (
        <Field label={t("status")} htmlFor="status">
          <Select id="status" name="status" defaultValue={defaults.status ?? "ACTIVE"}>
            <option value="ACTIVE">{t("active")}</option>
            <option value="INACTIVE">{t("inactive")}</option>
          </Select>
        </Field>
      )}
    </div>
  );
}
