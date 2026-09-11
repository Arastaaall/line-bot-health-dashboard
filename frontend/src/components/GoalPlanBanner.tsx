interface GoalPlanBannerProps {
  banner?: {
    show: boolean;
    message?: string;
  } | null;
}

export default function GoalPlanBanner({ banner }: GoalPlanBannerProps) {
  if (!banner || !banner.show || !banner.message) return null;

  return (
    <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-4 text-xs font-medium shadow-sm flex items-start gap-2">
      <span className="text-amber-500 text-sm shrink-0">⚠️</span>
      <div>{banner.message}</div>
    </div>
  );
}
