"use client";

import { useState } from "react";
import { api, type StaffUser } from "@/lib/api";
import { redirectToLoginIfUnauthorized } from "@/lib/session-client";
import { ActiveBadge, Button, Card, errorMessage, inputClass } from "../ui";

type Role = StaffUser["role"];

const roleLabel: Record<Role, string> = { admin: "Admin", operator: "Operator" };

export function UsersManager({
  slug,
  currentUserId,
  initialUsers,
}: {
  slug: string;
  currentUserId: string;
  initialUsers: StaffUser[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const replace = (updated: StaffUser) =>
    setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)));

  return (
    <div className="space-y-6">
      <Card
        title="Tambah akun staf"
        description="Operator bisa mengoperasikan loket. Admin juga bisa melihat dashboard dan mengelola data ini."
      >
        <CreateUserForm
          slug={slug}
          onCreated={(user) => setUsers((list) => [...list, user])}
        />
      </Card>

      <Card title={`Akun staf (${users.length})`}>
        <div className="divide-y divide-slate-100">
          {users.map((user) => (
            <UserRow
              key={user.id}
              slug={slug}
              user={user}
              isSelf={user.id === currentUserId}
              onSaved={replace}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function CreateUserForm({
  slug,
  onCreated,
}: {
  slug: string;
  onCreated: (user: StaffUser) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.admin.createUser(slug, { name, email, role, password }),
      );
      setName("");
      setEmail("");
      setRole("operator");
      setPassword("");
    } catch (e) {
      if (!redirectToLoginIfUnauthorized(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_9rem_1fr_auto]">
      <input
        aria-label="Nama"
        placeholder="Nama"
        required
        maxLength={100}
        className={inputClass}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        aria-label="Email"
        type="email"
        placeholder="Email"
        required
        autoComplete="off"
        className={inputClass}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <select
        aria-label="Peran"
        className={inputClass}
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
      >
        <option value="operator">Operator</option>
        <option value="admin">Admin</option>
      </select>
      <input
        aria-label="Password awal"
        type="password"
        placeholder="Password awal (min. 8 karakter)"
        required
        minLength={8}
        autoComplete="new-password"
        className={inputClass}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={busy}>
        Tambah
      </Button>
      {error && (
        <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-5">
          {error}
        </p>
      )}
    </form>
  );
}

function UserRow({
  slug,
  user,
  isSelf,
  onSaved,
}: {
  slug: string;
  user: StaffUser;
  isSelf: boolean;
  onSaved: (user: StaffUser) => void;
}) {
  const [name, setName] = useState(user.name);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(
    body: Parameters<typeof api.admin.updateUser>[2],
    successNotice?: string,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.admin.updateUser(slug, user.id, body);
      onSaved(updated);
      setName(updated.name);
      if (successNotice) setNotice(successNotice);
    } catch (e) {
      if (!redirectToLoginIfUnauthorized(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    await save(
      { password: newPassword },
      isSelf
        ? "Password diganti. Sesi lain milik Anda sudah diakhiri."
        : "Password diganti. Semua sesi akun ini sudah diakhiri.",
    );
    setNewPassword("");
    setShowPassword(false);
  }

  return (
    <div className="py-4">
      <div className="grid items-center gap-3 lg:grid-cols-[1fr_1fr_9rem_auto_auto_auto_auto]">
        <input
          aria-label={`Nama ${user.email}`}
          maxLength={100}
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="truncate text-sm text-slate-600" title={user.email}>
          {user.email}
          {isSelf && <span className="ml-1 text-xs text-slate-400">(Anda)</span>}
        </p>
        <select
          aria-label={`Peran ${user.email}`}
          className={inputClass}
          value={user.role}
          // Changing your own role could lock you out of this page.
          disabled={isSelf || busy}
          onChange={(e) => save({ role: e.target.value as Role })}
        >
          {(["operator", "admin"] as const).map((role) => (
            <option key={role} value={role}>
              {roleLabel[role]}
            </option>
          ))}
        </select>
        <ActiveBadge active={user.isActive} />
        <Button
          variant="primary"
          disabled={name.trim() === user.name || busy}
          onClick={() => save({ name: name.trim() })}
        >
          Simpan
        </Button>
        <Button disabled={busy} onClick={() => setShowPassword((v) => !v)}>
          Ganti password
        </Button>
        <Button
          disabled={isSelf || busy}
          title={isSelf ? "Tidak bisa menonaktifkan akun sendiri" : undefined}
          onClick={() => save({ isActive: !user.isActive })}
        >
          {user.isActive ? "Nonaktifkan" : "Aktifkan"}
        </Button>
      </div>

      {showPassword && (
        <form onSubmit={resetPassword} className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            aria-label={`Password baru ${user.email}`}
            type="password"
            placeholder="Password baru (min. 8 karakter)"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputClass}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Simpan password
          </Button>
        </form>
      )}
      {notice && <p className="mt-2 text-sm text-green-700">{notice}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
