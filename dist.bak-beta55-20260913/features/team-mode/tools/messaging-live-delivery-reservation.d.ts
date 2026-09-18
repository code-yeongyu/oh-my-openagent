import type { TeamModeConfig } from "../../../config/schema/team-mode";
import { type DeliveryReservation as TeamMailboxDeliveryReservation } from "@oh-my-opencode/team-core/team-mailbox/reservation";
export type DeliveryReservation = TeamMailboxDeliveryReservation;
export type NullableDeliveryReservation = DeliveryReservation | null;
export declare function releaseReservationSafely(reservation: NullableDeliveryReservation, input: {
    teamRunId: string;
    recipient: string;
    messageId: string;
}): Promise<void>;
export declare function releaseReservationsForRecipients(teamRunId: string, recipientNames: readonly string[], messageId: string, config: TeamModeConfig): Promise<void>;
