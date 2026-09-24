// Differs from v1: item text.
export function List() {
  return (
    <div id="list" style={{ height: 150, overflow: "auto", border: "1px solid #ccc" }}>
      {Array.from({ length: 200 }, (_, i) => (
        <div key={i}>Row {i} ★</div>
      ))}
    </div>
  );
}
