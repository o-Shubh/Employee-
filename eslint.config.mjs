import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", "storage/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }] } },
  {
    // Tenant isolation: the unscoped Prisma client may only be imported by an allow-list of files.
    files: ["src/**/*.{ts,tsx}"],
    // Allow-list: identity (before the tenant is known), platform admin, the global
    // email outbox, and cross-tenant background jobs.
    ignores: [
      "src/server/db/**",
      "src/server/auth/**",
      "src/server/mail/**",
      "src/server/jobs/**",
      "src/server/services/super-admin.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@prisma/client", importNames: ["PrismaClient"], message: "Use ctx.db (tenant-scoped) instead." }],
          // Matches the alias and any relative path to the unscoped client.
          patterns: [{ group: ["**/db/client", "@/server/db/client"], message: "Use ctx.db (tenant-scoped) via requireUser()/forTenant()." }],
        },
      ],
    },
  },
];

export default config;
