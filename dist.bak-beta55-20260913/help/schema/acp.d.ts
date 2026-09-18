import { z } from "zod";
export declare const AcpCapabilitySchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodString;
    enabled: z.ZodBoolean;
}, z.core.$strip>;
export declare const AcpAgentSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodNullable<z.ZodString>;
    capabilities: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
        enabled: z.ZodBoolean;
    }, z.core.$strip>>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AcpConnectionSchema: z.ZodObject<{
    id: z.ZodString;
    agentId: z.ZodString;
    state: z.ZodEnum<{
        connected: "connected";
        disconnected: "disconnected";
        error: "error";
    }>;
    startedAt: z.ZodNumber;
    messagesSent: z.ZodNumber;
    messagesReceived: z.ZodNumber;
}, z.core.$strip>;
export declare const AcpServerSchema: z.ZodObject<{
    hostname: z.ZodString;
    port: z.ZodNumber;
    running: z.ZodBoolean;
    uptime: z.ZodNumber;
    agents: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        version: z.ZodNullable<z.ZodString>;
        capabilities: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
            enabled: z.ZodBoolean;
        }, z.core.$strip>>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    connections: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        agentId: z.ZodString;
        state: z.ZodEnum<{
            connected: "connected";
            disconnected: "disconnected";
            error: "error";
        }>;
        startedAt: z.ZodNumber;
        messagesSent: z.ZodNumber;
        messagesReceived: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const AcpResultSchema: z.ZodObject<{
    server: z.ZodObject<{
        hostname: z.ZodString;
        port: z.ZodNumber;
        running: z.ZodBoolean;
        uptime: z.ZodNumber;
        agents: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            version: z.ZodNullable<z.ZodString>;
            capabilities: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                version: z.ZodString;
                enabled: z.ZodBoolean;
            }, z.core.$strip>>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        connections: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            agentId: z.ZodString;
            state: z.ZodEnum<{
                connected: "connected";
                disconnected: "disconnected";
                error: "error";
            }>;
            startedAt: z.ZodNumber;
            messagesSent: z.ZodNumber;
            messagesReceived: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    timestamp: z.ZodNumber;
}, z.core.$strip>;
export type AcpCapability = z.infer<typeof AcpCapabilitySchema>;
export type AcpAgent = z.infer<typeof AcpAgentSchema>;
export type AcpConnection = z.infer<typeof AcpConnectionSchema>;
export type AcpServer = z.infer<typeof AcpServerSchema>;
export type AcpResult = z.infer<typeof AcpResultSchema>;
