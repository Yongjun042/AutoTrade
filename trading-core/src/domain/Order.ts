import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { TradeIntentSide, TradeIntentOrderType } from './TradeIntent';

export enum OrderState {
  DRAFT = 'DRAFT',
  PENDING_SUBMIT = 'PENDING_SUBMIT',
  SUBMITTED = 'SUBMITTED',
  ACKED = 'ACKED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCEL_REQUESTED = 'CANCEL_REQUESTED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  ERROR = 'ERROR',
  PENDING_UNKNOWN = 'PENDING_UNKNOWN',
}

/**
 * Order - Core trading order entity with state machine
 * 
 * State Machine:
 * DRAFT -> PENDING_SUBMIT -> SUBMITTED -> ACKED -> FILLED
 *                                              -> PARTIALLY_FILLED -> FILLED
 *                                              -> CANCEL_REQUESTED -> CANCELLED
 *                                              -> REJECTED / EXPIRED
 */
@Entity('order')
export class Order {
  @PrimaryGeneratedColumn()
  orderId!: number;

  @Column({ nullable: true })
  intentId?: number;

  @Column()
  symbol!: string;

  @Column({ type: 'enum', enum: TradeIntentSide })
  side!: TradeIntentSide;

  @Column()
  qty!: number;

  @Column({ default: 0 })
  filledQty!: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  price?: number;

  @Column({ type: 'enum', enum: TradeIntentOrderType })
  orderType!: TradeIntentOrderType;

  @Column({ type: 'enum', enum: OrderState, default: OrderState.DRAFT })
  state!: OrderState;

  @Column({ nullable: true })
  brokerOrderId?: string;

  @Column({ nullable: true })
  timeInForceSec?: number;

  @Column({ nullable: true })
  submittedAt?: Date;

  @Column({ nullable: true })
  ackedAt?: Date;

  @Column({ nullable: true })
  filledAt?: Date;

  @Column({ nullable: true })
  lastStateAt?: Date;

  @Column({ nullable: true })
  rejectReason?: string;

  @Column({ nullable: true })
  idempotencyKey?: string;

  @CreateDateColumn()
  createdAt!: Date;

  /**
   * Check if state can transition to new state
   */
  canTransitionTo(newState: OrderState): boolean {
    return OrderStateTransitions.isValidTransition(this.state, newState);
  }

  /**
   * Check if order is in terminal state
   */
  isTerminal(): boolean {
    return (
      this.state === OrderState.FILLED ||
      this.state === OrderState.CANCELLED ||
      this.state === OrderState.REJECTED ||
      this.state === OrderState.EXPIRED
    );
  }

  /**
   * Check if order requires reconciliation
   */
  requiresReconciliation(): boolean {
    return (
      this.state === OrderState.SUBMITTED ||
      this.state === OrderState.PENDING_UNKNOWN ||
      this.state === OrderState.CANCEL_REQUESTED ||
      this.state === OrderState.ERROR
    );
  }
}

/**
 * Order State Transition Table
 * 
 * Defines valid state transitions for the Order state machine.
 */
export class OrderStateTransitions {
  private static transitions = new Map<OrderState, Set<OrderState>>();

  static {
    // Submit flow
    this.addTransition(OrderState.DRAFT, OrderState.PENDING_SUBMIT);
    this.addTransition(OrderState.PENDING_SUBMIT, OrderState.SUBMITTED);
    this.addTransition(OrderState.PENDING_SUBMIT, OrderState.ERROR);

    // ACK flow
    this.addTransition(OrderState.SUBMITTED, OrderState.ACKED);
    this.addTransition(OrderState.SUBMITTED, OrderState.REJECTED);
    this.addTransition(OrderState.SUBMITTED, OrderState.PENDING_UNKNOWN);
    this.addTransition(OrderState.SUBMITTED, OrderState.ERROR);

    // Fill flow
    this.addTransition(OrderState.ACKED, OrderState.PARTIALLY_FILLED);
    this.addTransition(OrderState.ACKED, OrderState.FILLED);
    this.addTransition(OrderState.PARTIALLY_FILLED, OrderState.PARTIALLY_FILLED);
    this.addTransition(OrderState.PARTIALLY_FILLED, OrderState.FILLED);

    // Cancel flow
    this.addTransition(OrderState.ACKED, OrderState.CANCEL_REQUESTED);
    this.addTransition(OrderState.PARTIALLY_FILLED, OrderState.CANCEL_REQUESTED);
    this.addTransition(OrderState.CANCEL_REQUESTED, OrderState.CANCELLED);
    this.addTransition(OrderState.CANCEL_REQUESTED, OrderState.REJECTED);
    this.addTransition(OrderState.CANCEL_REQUESTED, OrderState.FILLED);

    // Reconciliation results
    this.addTransition(OrderState.PENDING_UNKNOWN, OrderState.ACKED);
    this.addTransition(OrderState.PENDING_UNKNOWN, OrderState.PARTIALLY_FILLED);
    this.addTransition(OrderState.PENDING_UNKNOWN, OrderState.FILLED);
    this.addTransition(OrderState.PENDING_UNKNOWN, OrderState.CANCELLED);
    this.addTransition(OrderState.PENDING_UNKNOWN, OrderState.EXPIRED);

    // Error recovery
    this.addTransition(OrderState.ERROR, OrderState.ACKED);
    this.addTransition(OrderState.ERROR, OrderState.PARTIALLY_FILLED);
    this.addTransition(OrderState.ERROR, OrderState.FILLED);
    this.addTransition(OrderState.ERROR, OrderState.CANCELLED);

    // Expire
    this.addTransition(OrderState.DRAFT, OrderState.EXPIRED);
    this.addTransition(OrderState.ACKED, OrderState.EXPIRED);
    this.addTransition(OrderState.PARTIALLY_FILLED, OrderState.EXPIRED);
    this.addTransition(OrderState.SUBMITTED, OrderState.EXPIRED);
    this.addTransition(OrderState.PENDING_UNKNOWN, OrderState.EXPIRED);
  }

  private static addTransition(from: OrderState, to: OrderState) {
    const set = this.transitions.get(from) || new Set();
    set.add(to);
    this.transitions.set(from, set);
  }

  static isValidTransition(from: OrderState, to: OrderState): boolean {
    const validTargets = this.transitions.get(from);
    return validTargets ? validTargets.has(to) : false;
  }

  static isTerminal(state: OrderState): boolean {
    return (
      state === OrderState.FILLED ||
      state === OrderState.CANCELLED ||
      state === OrderState.REJECTED ||
      state === OrderState.EXPIRED
    );
  }

  static requiresReconciliation(state: OrderState): boolean {
    return (
      state === OrderState.SUBMITTED ||
      state === OrderState.PENDING_UNKNOWN ||
      state === OrderState.CANCEL_REQUESTED ||
      state === OrderState.ERROR
    );
  }
}
