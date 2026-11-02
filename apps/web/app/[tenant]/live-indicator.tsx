// Shows whether the page is receiving live updates.
export function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-slate-500"
      title={
        connected
          ? "Terhubung: perubahan tampil seketika"
          : "Menyambung ulang… data tetap diperbarui berkala"
      }
    >
      <span
        className={`h-2 w-2 rounded-full ${
          connected ? "bg-green-500" : "bg-amber-400"
        }`}
      />
      {connected ? "Live" : "Menyambung ulang…"}
    </span>
  );
}
