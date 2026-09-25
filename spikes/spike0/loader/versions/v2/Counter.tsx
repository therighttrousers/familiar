import { useState } from "react";

// Differs from v1: an added hook. React Refresh should remount this component only.
export function Counter() {
  const [n, setN] = useState(0);
  const [step] = useState(10);
  return (
    <p>
      Nested component state: <span id="count">{n}</span>{" "}
      <button id="inc" type="button" onClick={() => setN(n + step)}>
        +{step}
      </button>
    </p>
  );
}
