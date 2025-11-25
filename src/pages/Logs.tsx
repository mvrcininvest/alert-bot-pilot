import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Info, AlertTriangle } from "lucide-react";

export default function Logs() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ["bot-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
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
