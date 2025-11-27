import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

export type TimeFilter = "today" | "7d" | "30d" | "90d" | "all" | "custom";

interface TimeFiltersProps {
  selected: TimeFilter;
  onSelect: (filter: TimeFilter) => void;
  customRange?: { from: Date | undefined; to: Date | undefined };
  onCustomRangeChange?: (range: { from: Date | undefined; to: Date | undefined }) => void;
}

export function TimeFilters({ selected, onSelect, customRange, onCustomRangeChange }: TimeFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
        <Button
          variant={selected === "today" ? "default" : "ghost"}
          size="sm"
          onClick={() => onSelect("today")}
          className="text-xs"
        >
          Dziś
        </Button>
        <Button
          variant={selected === "7d" ? "default" : "ghost"}
          size="sm"
          onClick={() => onSelect("7d")}
          className="text-xs"
        >
          7 dni
        </Button>
        <Button
          variant={selected === "30d" ? "default" : "ghost"}
          size="sm"
          onClick={() => onSelect("30d")}
          className="text-xs"
        >
          30 dni
        </Button>
        <Button
          variant={selected === "90d" ? "default" : "ghost"}
          size="sm"
          onClick={() => onSelect("90d")}
          className="text-xs"
        >
          90 dni
        </Button>
        <Button
          variant={selected === "all" ? "default" : "ghost"}
          size="sm"
          onClick={() => onSelect("all")}
          className="text-xs"
        >
          Wszystkie
        </Button>
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={selected === "custom" ? "default" : "outline"}
            size="sm"
            className="text-xs"
          >
            <Calendar className="h-3 w-3 mr-1" />
            {selected === "custom" && customRange?.from && customRange?.to
              ? `${format(customRange.from, "dd MMM", { locale: pl })} - ${format(customRange.to, "dd MMM", { locale: pl })}`
              : "Zakres"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <CalendarComponent
            mode="range"
            selected={customRange}
            onSelect={(range) => {
              if (onCustomRangeChange && range) {
                onCustomRangeChange(range as { from: Date | undefined; to: Date | undefined });
                if (range.from && range.to) {
                  onSelect("custom");
                }
              }
            }}
            numberOfMonths={2}
            locale={pl}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
