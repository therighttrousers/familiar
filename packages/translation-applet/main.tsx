import { store, updateText } from "@harness/state";
import "./app.css";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import type { State } from "./schema";

export default function Applet() {
  const state = store.use<State>();
  return (
    <main className="grid h-dvh grid-rows-2 gap-4 bg-background p-4 text-foreground md:grid-cols-2 md:grid-rows-1">
      <Side label="English" field="english" value={state.english} />
      <Side label="Spanish" field="spanish" value={state.spanish} />
    </main>
  );
}

function Side({ label, field, value }: { label: string; field: keyof State; value: string }) {
  const id = `text-${field}`;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        className="min-h-0 flex-1 resize-none [field-sizing:fixed]"
        value={value}
        onChange={(e) => store.change<State>((d) => updateText(d, [field], e.target.value))}
      />
    </div>
  );
}
