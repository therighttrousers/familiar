import { useState } from "react";

export function Counter() {
  const [n, setN] = useState(0);
  return (
    <p>
      Nested component state: <span id="count">{n}</span>{" "}
      <button id="inc" type="button" onClick={() => setN(n + 1)}>
        +1
      </button>
    </p>
  );
}
