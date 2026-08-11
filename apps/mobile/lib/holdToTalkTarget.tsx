import { ReactNode, useCallback, useRef } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
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
 * Hold-to-talk host that keeps the pan (iOS ScrollView must not steal it) and
 * treats sliding off the visible control as cancel — not as a still-pressed
 * red button.
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

  const onGrant = useCallback(
    (e: GestureResponderEvent) => {
      if (disabledRef.current || holdingRef.current) return;
      holdingRef.current = true;
      armedRef.current = false;
      originXRef.current = e.nativeEvent.pageX;
      originYRef.current = e.nativeEvent.pageY;
      startRef.current(e);
      // iOS can delay grant until the finger has already slid off a light
      // rest. Don't keep a hold that started outside the control.
      const { locationX, locationY } = e.nativeEvent;
      const { width, height } = sizeRef.current;
      if (
        width > 0 &&
        (locationX < -EDGE_SLOP ||
          locationY < -EDGE_SLOP ||
          locationX > width + EDGE_SLOP ||
          locationY > height + EDGE_SLOP)
      ) {
        endHold(true);
      }
    },
    [endHold],
  );

  const onMove = useCallback(
    (e: GestureResponderEvent) => {
      if (!holdingRef.current) return;
      const { locationX, locationY, pageX, pageY } = e.nativeEvent;
      const { width, height } = sizeRef.current;
      const left =
        width > 0 &&
        (locationX < -EDGE_SLOP ||
          locationY < -EDGE_SLOP ||
          locationX > width + EDGE_SLOP ||
          locationY > height + EDGE_SLOP);
      if (left) {
        endHold(true);
        return;
      }
      const slid =
        directionRef.current === "left"
          ? originXRef.current - pageX > HOLD_TO_TALK_CANCEL_PX
          : originYRef.current - pageY > HOLD_TO_TALK_CANCEL_PX;
      setArmed(slid);
    },
    [endHold, setArmed],
  );

  const onRelease = useCallback(() => endHold(false), [endHold]);
  const onTerminate = useCallback(() => endHold(true), [endHold]);
  const onStartShouldSet = useCallback(() => !disabledRef.current, []);
  const onMoveShouldSet = useCallback(() => holdingRef.current, []);
  const onTerminationRequest = useCallback(() => false, []);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeRef.current = { width, height };
  }, []);

  return (
    <View
      collapsable={false}
      onStartShouldSetResponder={onStartShouldSet}
      onMoveShouldSetResponder={onMoveShouldSet}
      onResponderTerminationRequest={onTerminationRequest}
      onLayout={onLayout}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={onTerminate}
      onTouchCancel={onTerminate}
      style={style}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <View pointerEvents="none">{children}</View>
    </View>
  );
}
