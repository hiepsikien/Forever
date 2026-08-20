import { ReactNode, useCallback, useRef } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  StyleProp,
  View,
  ViewStyle,
} from "react-native";

import { HOLD_TO_TALK_CANCEL_PX } from "@/lib/holdToTalk";

/** Finger may drift this far past the hit ring before we treat it as gone. */
const EDGE_SLOP = 20;

type Props = {
  disabled?: boolean;
  /** Extra cancel cue in that direction; leaving the control also cancels. */
  cancelDirection: "left" | "up";
  onHoldStart: (e: GestureResponderEvent) => void;
  onCancelArmedChange: (armed: boolean) => void;
  onHoldEnd: (cancelled: boolean) => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/**
 * Hold-to-talk host. Pressable gives Android the same reliable touch path as
 * the old Mic button; onTouchMove keeps slide-to-cancel and leaving the hit
 * ring. The responder system was iOS-first and often never granted on Android.
 */
export function HoldToTalkTarget({
  disabled,
  cancelDirection,
  onHoldStart,
  onCancelArmedChange,
  onHoldEnd,
  style,
  children,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const sizeRef = useRef({ width: 0, height: 0 });
  const originXRef = useRef(0);
  const originYRef = useRef(0);
  const holdingRef = useRef(false);
  const armedRef = useRef(false);
  const disabledRef = useRef(disabled);
  const directionRef = useRef(cancelDirection);
  const startRef = useRef(onHoldStart);
  const armedChangeRef = useRef(onCancelArmedChange);
  const endRef = useRef(onHoldEnd);
  disabledRef.current = disabled;
  directionRef.current = cancelDirection;
  startRef.current = onHoldStart;
  armedChangeRef.current = onCancelArmedChange;
  endRef.current = onHoldEnd;

  const setArmed = useCallback((next: boolean) => {
    if (armedRef.current === next) return;
    armedRef.current = next;
    armedChangeRef.current(next);
  }, []);

  const endHold = useCallback(
    (cancelled: boolean) => {
      if (!holdingRef.current) return;
      holdingRef.current = false;
      endRef.current(cancelled);
      // Visual cancel red is only for an in-progress take. After the hold
      // ends the parent must not be left with cancelArmed stuck true.
      setArmed(false);
    },
    [setArmed],
  );

  const leftHitRing = useCallback((locationX: number, locationY: number) => {
    const { width, height } = sizeRef.current;
    if (width <= 0) return false;
    return (
      locationX < -EDGE_SLOP ||
      locationY < -EDGE_SLOP ||
      locationX > width + EDGE_SLOP ||
      locationY > height + EDGE_SLOP
    );
  }, []);

  const onPressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (disabledRef.current || holdingRef.current) return;
      holdingRef.current = true;
      armedRef.current = false;
      originXRef.current = e.nativeEvent.pageX;
      originYRef.current = e.nativeEvent.pageY;
      startRef.current(e);
      // iOS can delay press-in until the finger has already slid off a light
      // rest. Don't keep a hold that started outside the control.
      const { locationX, locationY } = e.nativeEvent;
      if (leftHitRing(locationX, locationY)) {
        endHold(true);
      }
    },
    [endHold, leftHitRing],
  );

  const onTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      if (!holdingRef.current) return;
      const { locationX, locationY, pageX, pageY } = e.nativeEvent;
      if (leftHitRing(locationX, locationY)) {
        endHold(true);
        return;
      }
      const slid =
        directionRef.current === "left"
          ? originXRef.current - pageX > HOLD_TO_TALK_CANCEL_PX
          : originYRef.current - pageY > HOLD_TO_TALK_CANCEL_PX;
      setArmed(slid);
    },
    [endHold, leftHitRing, setArmed],
  );

  const onPressOut = useCallback(() => endHold(false), [endHold]);
  const onTouchCancel = useCallback(() => endHold(true), [endHold]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeRef.current = { width, height };
  }, []);

  return (
    <Pressable
      collapsable={false}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      onLayout={onLayout}
      style={style}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <View pointerEvents="none">{children}</View>
    </Pressable>
  );
}
