// 五步驟進度：index < current 已完成、== current 進行中、> current 未達（純展示）。
export default function StepRail({ steps, current }) {
  return (
    <div className="steprail">
      {steps.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <div key={step.key} className={`steprail__item steprail__item--${state}`}>
            {i + 1}. {step.label}
          </div>
        )
      })}
    </div>
  )
}
