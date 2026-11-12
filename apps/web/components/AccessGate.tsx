"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogAction, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/sodium/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/sodium/ui/field";
import { Input } from "@/components/sodium/ui/input";
import { registerAccessAsker, storeAccessCode } from "@/lib/access";
import { api } from "@/lib/api";

/**
 * The one-time access dialog. A live run spends the demo OpenRouter key, so the api asks for a code; this dialog
 * opens on the first attempt, checks the code with the api and keeps it in this browser. Mounted once in the layout.
 */
export function AccessGate() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const settle = useRef<((ok: boolean) => void) | null>(null);
  const passed = useRef(false);

  useEffect(
    () =>
      registerAccessAsker(
        () =>
          new Promise<boolean>((resolve) => {
            settle.current?.(false);
            settle.current = resolve;
            passed.current = false;
            setCode("");
            setOpen(true);
          }),
      ),
    [],
  );

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      settle.current?.(passed.current);
      settle.current = null;
    }
  }

  async function check() {
    const value = code.trim();
    if (!value) throw new Error("Enter the access code.");
    await api.checkAccess(value);
    storeAccessCode(value);
    passed.current = true;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>access code</DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-4">
          <DialogDescription>
            A live run calls real models on our key, so it needs the access code sent to the judges. You enter it once in this browser. Finished runs stay open to read without it.
          </DialogDescription>
          <Field>
            <FieldLabel>Access code</FieldLabel>
            <Input mode="password" mono data-autofocus autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
            <FieldDescription>Case-sensitive, as written in the message you received.</FieldDescription>
          </Field>
        </DialogBody>
        <DialogFooter defaultAction="primary">
          <DialogClose>Cancel</DialogClose>
          <DialogAction onAction={check} pendingLabel="Checking">
            Start the run
          </DialogAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
