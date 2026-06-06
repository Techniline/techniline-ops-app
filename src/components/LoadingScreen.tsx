export function LoadingScreen({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-8">
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}
