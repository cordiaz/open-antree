"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "", label: "Dashboard" },
  { href: "/services", label: "Layanan" },
  { href: "/counters", label: "Loket" },
  { href: "/users", label: "Akun Staf" },
];

export function AdminNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${slug}/admin`;

  return (
    <nav className="mx-auto mt-4 flex max-w-7xl gap-1 overflow-x-auto px-6">
      {TABS.map((tab) => {
        const href = base + tab.href;
        const active = pathname === href;
        return (
          <Link
            key={tab.href}
            href={href}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${
              active
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
