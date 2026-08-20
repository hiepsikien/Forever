import { ReactNode, useCallback, useRef, useState } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
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
 * Hold-to-talk host. Uses low-level touch events (not the responder system) so
 * Android gets the same reliable path as Pressable buttons like «Nghe lại».
 * Immediate pressed styling fires before async mic open.
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
  const [pressed, setPressed] = useState(false);
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
      setPressed(false);
      endRef.current(cancelled);
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

  const onTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      if (disabledRef.current || holdingRef.current) return;
      holdingRef.current = true;
      setPressed(true);
      armedRef.current = false;
      originXRef.current = e.nativeEvent.pageX;
      originYRef.current = e.nativeEvent.pageY;
      startRef.current(e);
      // Android locationX/Y at touch-start are unreliable; only iOS checks here.
      if (Platform.OS === "ios") {
        const { locationX, locationY } = e.nativeEvent;
        if (leftHitRing(locationX, locationY)) {
          endHold(true);
        }
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

  const onTouchEnd = useCallback(() => endHold(false), [endHold]);
  const onTouchCancel = useCallback(() => endHold(true), [endHold]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeRef.current = { width, height };
  }, []);

  return (
    <View
      collapsable={false}
      onTouchStart={disabled ? undefined : onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onLayout={onLayout}
      style={[style, pressed && !disabled && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <View pointerEvents="none">{children}</View>
    </View>
  );
}

const styles = {
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
} as const;
