export default function Loading({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-gray-500 text-sm">
      <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      {label || '読み込み中...'}
    </div>
  );
}