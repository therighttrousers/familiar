// Spike 0 loader. Owns the React root and renders the active version's Applet.
//
// Modes (?mode=...):
//   element  <Applet /> as an element; a new version is a new component type.
//            This is what the original project did (onRender returned the component).
//   call     A stable Host component calls Applet() as a plain function, so Applet's
//            own hooks belong to Host. Nested components are still elements.
//   refresh  Like element, but versions register their components with React Refresh
//            under stable IDs, and activation runs performReactRefresh().

const mode = new URLSearchParams(location.search).get("mode") ?? "element";
document.getElementById("mode").textContent = mode;

// React Refresh must hook into React DOM before React DOM loads.
const Refresh = (await import("react-refresh/runtime")).default;
if (mode === "refresh") {
  Refresh.injectIntoGlobalHook(window);
  globalThis.__refreshReg = (type, id) => Refresh.register(type, id);
  globalThis.__refreshSig = () => Refresh.createSignatureFunctionForTransform();
} else {
  globalThis.__refreshReg = () => {};
  globalThis.__refreshSig = () => (type) => type;
}

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");

let setApplet;
function Host({ initial }) {
  const [Applet, set] = React.useState(() => initial);
  setApplet = set;
  return mode === "call" ? Applet() : React.createElement(Applet);
}

// In refresh mode, every activation imports a fresh module instance. Re-activating an
// already-imported version would otherwise reuse its old component types, which React
// Refresh ignores (register() skips types it has seen), so the page would stay on the
// newer version. This relies on each version being a single bundled file.
let loads = 0;
async function load(v) {
  const query = mode === "refresh" ? `?activation=${++loads}` : "";
  return (await import(`/${v}/main.js${query}`)).default;
}

let active;
window.activate = async (v) => {
  const Applet = await load(v);
  active = v;
  React.startTransition(() => setApplet(() => Applet));
  if (mode === "refresh") Refresh.performReactRefresh();
  await new Promise((r) => setTimeout(r, 100));
  return v;
};

// Probe: what survives an activation.
const probed = ["controlled", "uncontrolled", "list", "count", "title"];
window.mark = () => {
  for (const id of probed) document.getElementById(id).__spikeMark = true;
};
window.snapshot = () => {
  const el = (id) => document.getElementById(id);
  const a = document.activeElement;
  return {
    version: active,
    title: el("title").textContent,
    controlled: el("controlled").value,
    uncontrolled: el("uncontrolled").value,
    count: el("count").textContent,
    listScrollTop: el("list").scrollTop,
    focus: a?.id || a?.tagName,
    selection: a && "selectionStart" in a ? [a.selectionStart, a.selectionEnd] : null,
    sameDomNode: Object.fromEntries(probed.map((id) => [id, !!el(id).__spikeMark])),
  };
};

document.addEventListener("keydown", (e) => {
  if (e.altKey && (e.key === "1" || e.key === "2")) {
    e.preventDefault();
    window.activate(`v${e.key}`);
  }
});

createRoot(document.getElementById("root")).render(React.createElement(Host, { initial: await load("v1") }));
active = "v1";
