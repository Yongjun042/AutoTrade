import { OrderState, OrderStateTransitions } from '../domain/Order';

describe('OrderStateTransitions', () => {
  describe('isValidTransition', () => {
    test('DRAFT -> PENDING_SUBMIT is valid', () => {
      expect(OrderStateTransitions.isValidTransition(OrderState.DRAFT, OrderState.PENDING_SUBMIT)).toBe(true);
    });

    test('PENDING_SUBMIT -> SUBMITTED is valid', () => {
      expect(OrderStateTransitions.isValidTransition(OrderState.PENDING_SUBMIT, OrderState.SUBMITTED)).toBe(true);
    });

    test('SUBMITTED -> ACKED is valid', () => {
      expect(OrderStateTransitions.isValidTransition(OrderState.SUBMITTED, OrderState.ACKED)).toBe(true);
    });

    test('ACKED -> FILLED is valid', () => {
      expect(OrderStateTransitions.isValidTransition(OrderState.ACKED, OrderState.FILLED)).toBe(true);
    });

    test('ACKED -> CANCEL_REQUESTED is valid', () => {
      expect(OrderStateTransitions.isValidTransition(OrderState.ACKED, OrderState.CANCEL_REQUESTED)).toBe(true);
    });

    test('CANCEL_REQUESTED -> CANCELLED is valid', () => {
      expect(OrderStateTransitions.isValidTransition(OrderState.CANCEL_REQUESTED, OrderState.CANCELLED)).toBe(true);
    });

    test('FILLED -> DRAFT is NOT valid (terminal state)', () => {
      expect(OrderStateTransitions.isValidTransition(OrderState.FILLED, OrderState.DRAFT)).toBe(false);
    });

    test('DRAFT -> FILLED is NOT valid (must go through submit flow)', () => {
      expect(OrderStateTransitions.isValidTransition(OrderState.DRAFT, OrderState.FILLED)).toBe(false);
    });

    test('SUBMITTED -> PENDING_UNKNOWN is valid (timeout case)', () => {
      expect(OrderStateTransitions.isValidTransition(OrderState.SUBMITTED, OrderState.PENDING_UNKNOWN)).toBe(true);
    });
  });

  describe('isTerminal', () => {
    test('FILLED is terminal', () => {
      expect(OrderStateTransitions.isTerminal(OrderState.FILLED)).toBe(true);
    });

    test('CANCELLED is terminal', () => {
      expect(OrderStateTransitions.isTerminal(OrderState.CANCELLED)).toBe(true);
    });

    test('REJECTED is terminal', () => {
      expect(OrderStateTransitions.isTerminal(OrderState.REJECTED)).toBe(true);
    });

    test('EXPIRED is terminal', () => {
      expect(OrderStateTransitions.isTerminal(OrderState.EXPIRED)).toBe(true);
    });

    test('DRAFT is NOT terminal', () => {
      expect(OrderStateTransitions.isTerminal(OrderState.DRAFT)).toBe(false);
    });

    test('ACKED is NOT terminal', () => {
      expect(OrderStateTransitions.isTerminal(OrderState.ACKED)).toBe(false);
    });
  });

  describe('requiresReconciliation', () => {
    test('SUBMITTED requires reconciliation', () => {
      expect(OrderStateTransitions.requiresReconciliation(OrderState.SUBMITTED)).toBe(true);
    });

    test('PENDING_UNKNOWN requires reconciliation', () => {
      expect(OrderStateTransitions.requiresReconciliation(OrderState.PENDING_UNKNOWN)).toBe(true);
    });

    test('CANCEL_REQUESTED requires reconciliation', () => {
      expect(OrderStateTransitions.requiresReconciliation(OrderState.CANCEL_REQUESTED)).toBe(true);
    });

    test('ERROR requires reconciliation', () => {
      expect(OrderStateTransitions.requiresReconciliation(OrderState.ERROR)).toBe(true);
    });

    test('FILLED does NOT require reconciliation', () => {
      expect(OrderStateTransitions.requiresReconciliation(OrderState.FILLED)).toBe(false);
    });
  });
});

describe('Order Entity', () => {
  test('isTerminal returns true for terminal states', () => {
    const order = new Order();
    order.state = OrderState.FILLED;
    expect(order.isTerminal()).toBe(true);

    order.state = OrderState.CANCELLED;
    expect(order.isTerminal()).toBe(true);
  });

  test('isTerminal returns false for non-terminal states', () => {
    const order = new Order();
    order.state = OrderState.ACKED;
    expect(order.isTerminal()).toBe(false);
  });

  test('requiresReconciliation returns true for uncertain states', () => {
    const order = new Order();
    order.state = OrderState.SUBMITTED;
    expect(order.requiresReconciliation()).toBe(true);

    order.state = OrderState.PENDING_UNKNOWN;
    expect(order.requiresReconciliation()).toBe(true);
  });

  test('requiresReconciliation returns false for known states', () => {
    const order = new Order();
    order.state = OrderState.FILLED;
    expect(order.requiresReconciliation()).toBe(false);
  });
});
