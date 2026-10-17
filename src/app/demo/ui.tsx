// Small presentational pieces shared by the demo steps, in the team's design.

export const STEP_NAMES = ["Call & dispatch", "Inspect & cover", "Choose replacement", "Recover GPUs", "Reconcile", "CFO outcome"];

export const SPONSORS = [
  "ElevenLabs · live voice",
  "Nicrron · assessment",
  "PRISM · credit guardrail",
  "Agora · simulated market",
  "Netbalance + PRISM checks",
  "Netbalance · CFO + EPA carbon",
];

export function Head({ i, title, desc }: { i: number; title: string; desc: string }) {
  return (
    <div className="panel-head">
      <div>
        <div className="eyebrow">{STEP_NAMES[i]}</div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      <span className="badge">{SPONSORS[i]}</span>
    </div>
  );
}

export function Calendar(props: { title: string; desc: string; time: string; date: string; place: string; ampm?: string }) {
  const day = new Date(`${props.date}T12:00:00`);
  return (
    <div className="booked-calendar fade-in">
      <div className="calendar-top">
        <b>{day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</b>
        <span className="badge green">✓ Confirmed</span>
      </div>
      <div className="calendar-event">
        <div className="event-time">
          {props.time}
          <span>{props.ampm ?? "PM"} · ET</span>
        </div>
        <div>
          <b>{props.title}</b>
          <p>{props.desc}</p>
          <span>
            {day.toLocaleDateString("en-US", { weekday: "long" })} · {props.place} · simulated
          </span>
        </div>
      </div>
    </div>
  );
}

export function Spinner({ light }: { light?: boolean }) {
  return <span className={`spinner ${light ? "light" : ""}`} />;
}
