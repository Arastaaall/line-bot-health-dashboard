import PfcDonut from './components/PfcDonut';
import NutrientBar from './components/NutrientBar';

function Insufficient({ b }: { b: any }) {
  return <p className="text-xs text-gray-400 py-2">{b?.status === 'empty' ? '記録がありません' : 'まだデータが足りません'}</p>;
}

export default function AnalysisTab({ data }: { data: any }) {
  if (!data) return null;
  const n1 = data.n1_pfc, n2 = data.n2_micronutrients, n3 = data.n3_hints, n4 = data.n4_meal_frequency, n5 = data.n5_top_menus;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
        <p className="text-sm font-bold text-gray-600">PFCバランス</p>
        {n1?.status === 'ok' ? (
          <>
            <p className="text-lg font-bold">日平均 {n1.avg_calories} kcal <span className="text-[10px] text-gray-400">（{data.recorded_days}日間の記録に基づく）</span></p>
            <p className="text-xs text-gray-600">P {n1.avg_protein_g}g / F {n1.avg_fat_g}g / C {n1.avg_carbs_g}g</p>
            {n1.ratio_protein_pct !== null && <PfcDonut p={n1.ratio_protein_pct} f={n1.ratio_fat_pct} c={n1.ratio_carbs_pct} />}
            <p className="text-[10px] text-gray-400">
              参考範囲: P {n1.reference_range.protein_pct[0]}-{n1.reference_range.protein_pct[1]}% / F {n1.reference_range.fat_pct[0]}-{n1.reference_range.fat_pct[1]}% / C {n1.reference_range.carbs_pct[0]}-{n1.reference_range.carbs_pct[1]}%
            </p>
          </>
        ) : <Insufficient b={n1} />}
        {data.notes?.pfc && <p className="text-[10px] text-gray-400">{data.notes.pfc}</p>}
        {data.notes?.recorded_days && <p className="text-[10px] text-gray-400">{data.notes.recorded_days}</p>}
        {data.notes?.protein_bcaa_note && (
          <details>
            <summary className="text-[10px] text-blue-600">タンパク質とBCAAについて（タップで展開）</summary>
            <p className="text-[10px] text-gray-400 mt-1">{data.notes.protein_bcaa_note}</p>
          </details>
        )}
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
        <p className="text-sm font-bold text-gray-600">微量栄養素</p>
        {n2?.status === 'ok' ? (
          <div className="space-y-2">
            {n2.nutrients.map((nut: any) => (
              <NutrientBar key={nut.key} name={nut.name} pctDisplay={nut.achievement_pct_display} unit={nut.unit} avg={nut.avg_intake} refValue={nut.reference_value} />
            ))}
          </div>
        ) : <Insufficient b={n2} />}
      </div>

      <details className="bg-white rounded-xl p-4 shadow-sm space-y-1">
        <summary className="text-sm font-bold text-gray-600">不足ヒント（タップで展開）</summary>
        {n3 && n3.length > 0
          ? n3.map((h: any, i: number) => <p key={i} className="text-[11px] text-gray-600">・{h.message}</p>)
          : <p className="text-xs text-gray-400">該当するヒントはありません</p>}
      </details>

      <div className="bg-white rounded-xl p-4 shadow-sm space-y-1">
        <p className="text-sm font-bold text-gray-600">よく記録するメニュー</p>
        {n5 && n5.length > 0
          ? n5.map((m: any, i: number) => (
              <p key={i} className="text-[11px] text-gray-600">{i + 1}. {m.menu_name}（{m.count}回 / {m.avg_calories}kcal / P{m.avg_protein_g}g）</p>
            ))
          : <p className="text-xs text-gray-400">記録がありません</p>}
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm">
        {n4?.status === 'ok'
          ? <p className="text-sm font-bold">1日平均食事記録回数: {n4.avg_meals_per_day}食</p>
          : <Insufficient b={n4} />}
      </div>

      {data.notes?.reference && <p className="text-[10px] text-gray-400">{data.notes.reference}</p>}
      {data.notes?.no_record && <p className="text-[10px] text-gray-400">{data.notes.no_record}</p>}
    </div>
  );
}