"use client";

import { useState } from "react";
import { SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  value: string;
  onChange: (val: string) => void;
};

export function CustomInstructionsModal({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = () => {
    onChange(draft);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Custom instructions"
                  onClick={() => setDraft(value)}
                />
              }
            />
          }
        >
          <SettingsIcon />
        </TooltipTrigger>
        <TooltipContent>Custom instructions</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Custom Instructions</DialogTitle>
          <DialogDescription>
            These instructions are prepended to the system prompt for every
            message.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="custom-instructions">Instructions</FieldLabel>
            <Textarea
              id="custom-instructions"
              placeholder="e.g. Always respond in Spanish. Be concise. Use bullet points."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
