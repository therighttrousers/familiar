import { useState } from "react";
import { Counter } from "./Counter";
import { List } from "./List";

export default function Applet() {
  const [text, setText] = useState("");
  return (
    <div style={{ fontFamily: "sans-serif", padding: 16, borderLeft: "6px solid steelblue" }}>
      <h1 id="title">Version 1</h1>
      <p>
        Controlled input (React state):{" "}
        <input id="controlled" value={text} onChange={(e) => setText(e.target.value)} />
      </p>
      <p>
        Uncontrolled textarea (DOM state): <textarea id="uncontrolled" defaultValue="" />
      </p>
      <Counter />
      <List />
    </div>
  );
}
