import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';

export enum TradeIntentSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum TradeIntentOrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
}

export enum TradeIntentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  CONVERTED_TO_ORDER = 'CONVERTED_TO_ORDER',
}

/**
 * Trade Intent - AI generated trading proposal
 * 
 * Standard output format from AI Brain to Trading Core.
 * Policy & Risk Engine validates this before creating an Order.
 */
@Entity('trade_intent')
export class TradeIntent {
  @PrimaryGeneratedColumn()
  intentId!: number;

  @Column({ unique: true })
  idempotencyKey!: string;

  @Column()
  strategyId!: string;

  @Column()
  symbol!: string;

  @Column({ type: 'enum', enum: TradeIntentSide })
  side!: TradeIntentSide;

  @Column()
  intentQty!: number;

  @Column({ type: 'enum', enum: TradeIntentOrderType, nullable: true })
  orderType?: TradeIntentOrderType;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  limitPrice?: number;

  @Column({ nullable: true })
  timeInForceSec?: number;

  @Column({ type: 'double precision', nullable: true })
  confidence?: number;

  @Column({ type: 'text', nullable: true })
  reasons?: string;

  @Column({ nullable: true })
  expiresAt?: Date;

  @Column({ type: 'enum', enum: TradeIntentStatus, default: TradeIntentStatus.PENDING })
  status!: TradeIntentStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
