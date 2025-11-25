import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Info, AlertTriangle, Search, Calendar } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

export default function Logs() {
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: logs, isLoading } = useQuery({
    queryKey: ["bot-logs", searchQuery, levelFilter, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from("bot_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);

      // Filter by level
      if (levelFilter !== "all") {
        query = query.eq("level", levelFilter);
      }

      // Filter by date range
      if (dateFrom) {
        query = query.gte("created_at", new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        query = query.lte("created_at", endDate.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      // Client-side search filter
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        return data?.filter((log) => 
          log.message.toLowerCase().includes(lowerQuery) ||
          log.function_name.toLowerCase().includes(lowerQuery) ||
          JSON.stringify(log.metadata || {}).toLowerCase().includes(lowerQuery)
        );
      }

      return data;
    },
    refetchInterval: 5000,
  });

  const infoLogs = logs?.filter((log) => log.level === "info") || [];
  const warnLogs = logs?.filter((log) => log.level === "warn") || [];
  const errorLogs = logs?.filter((log) => log.level === "error") || [];

  const LogIcon = ({ level }: { level: string }) => {
    if (level === "error") return <AlertCircle className="h-4 w-4 text-destructive" />;
    if (level === "warn") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <Info className="h-4 w-4 text-blue-500" />;
  };

  const LogList = ({ logs }: { logs: any[] }) => (
    <ScrollArea className="h-[600px]">
      <div className="space-y-2">
        {logs.map((log) => (
          <Card key={log.id}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <LogIcon level={log.level} />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={log.level === "error" ? "destructive" : log.level === "warn" ? "secondary" : "default"}>
                      {log.level.toUpperCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                    <Badge variant="outline">{log.function_name}</Badge>
                  </div>
                  <p className="text-sm">{log.message}</p>
                  {log.metadata && (
                    <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );

  if (isLoading) {
    return <div>Ładowanie logów...</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Logi Bota</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Search and Filters */}
          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search */}
              <div className="space-y-2">
                <Label htmlFor="search">Szukaj</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search"
                    placeholder="Szukaj w logach..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Level Filter */}
              <div className="space-y-2">
                <Label htmlFor="level">Poziom</Label>
                <Select value={levelFilter} onValueChange={setLevelFilter}>
                  <SelectTrigger id="level">
                    <SelectValue placeholder="Wszystkie" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Wszystkie</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warn">Ostrzeżenia</SelectItem>
                    <SelectItem value="error">Błędy</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Date From */}
              <div className="space-y-2">
                <Label htmlFor="dateFrom">Od daty</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="dateFrom"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Date To */}
              <div className="space-y-2">
                <Label htmlFor="dateTo">Do daty</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="dateTo"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            {/* Results count */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4" />
              <span>
                Znaleziono {logs?.length || 0} logów
                {(searchQuery || levelFilter !== "all" || dateFrom || dateTo) && " (filtrowane)"}
              </span>
            </div>
          </div>

          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">Wszystkie ({logs?.length || 0})</TabsTrigger>
              <TabsTrigger value="info">Info ({infoLogs.length})</TabsTrigger>
              <TabsTrigger value="warn">Ostrzeżenia ({warnLogs.length})</TabsTrigger>
              <TabsTrigger value="error">Błędy ({errorLogs.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="all">
              <LogList logs={logs || []} />
            </TabsContent>
            <TabsContent value="info">
              <LogList logs={infoLogs} />
            </TabsContent>
            <TabsContent value="warn">
              <LogList logs={warnLogs} />
            </TabsContent>
            <TabsContent value="error">
              <LogList logs={errorLogs} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
