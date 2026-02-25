import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum OrderEventType {
  SUBMIT = 'SUBMIT',
  SUBMIT_SENT = 'SUBMIT_SENT',
  ACK = 'ACK',
  BROKER_REJECT = 'BROKER_REJECT',
  TIMEOUT = 'TIMEOUT',
  NET_ERROR = 'NET_ERROR',
  PARTIAL_FILL = 'PARTIAL_FILL',
  FILL = 'FILL',
  CANCEL_REQ = 'CANCEL_REQ',
  CANCEL_ACK = 'CANCEL_ACK',
  CANCEL_REJECT = 'CANCEL_REJECT',
  EXPIRE = 'EXPIRE',
  RECONCILE_FOUND = 'RECONCILE_FOUND',
  RECONCILE_NOT_FOUND = 'RECONCILE_NOT_FOUND',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Order Event - Event sourcing for order state changes
 * 
 * Every state transition creates an event for audit and debugging
 */
@Entity('order_event')
export class OrderEvent {
  @PrimaryGeneratedColumn()
  eventId!: number;

  @Column()
  orderId!: number;

  @Column({ type: 'enum', enum: OrderEventType })
  eventType!: OrderEventType;

  @Column({ nullable: true })
  fromState?: string;

  @Column({ nullable: true })
  toState?: string;

  @Column({ type: 'text', nullable: true })
  payload?: string;

  @CreateDateColumn()
  timestamp!: Date;
}
