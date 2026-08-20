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
/** Samsung/Android often emit bogus move coords right after touch-start. */
const MOVE_ARM_MS = Platform.OS === "android" ? 450 : 0;
/**
 * Wait before opening the mic. Filters tap noise and lets the gesture settle
 * before setAudioMode (which triggers ACTION_CANCEL on many Samsungs).
 */
const PRESS_ACTIVATE_MS = Platform.OS === "android" ? 100 : 0;
/**
 * Audio-mode switch on Samsung fires ACTION_CANCEL while the finger is still
 * down — that ended the hold (red flash → idle). Ignore cancel on Android;
 * real lift still gets touchEnd. AppState covers backgrounding.
 */
const IGNORE_TOUCH_CANCEL = Platform.OS === "android";

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
 * Hold-to-talk host. Low-level touch events (not the responder system).
 * On Android we only slide-to-cancel via pageX/pageY — locationX/Y from move
 * events are unreliable on Samsung and were ending the hold immediately.
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
  const startedAtRef = useRef(0);
  const holdingRef = useRef(false);
  const activatedRef = useRef(false);
  const armedRef = useRef(false);
  const activateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startEventRef = useRef<GestureResponderEvent | null>(null);
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

  const clearActivateTimer = useCallback(() => {
    if (activateTimerRef.current) {
      clearTimeout(activateTimerRef.current);
      activateTimerRef.current = null;
    }
  }, []);

  const setArmed = useCallback((next: boolean) => {
    if (armedRef.current === next) return;
    armedRef.current = next;
    armedChangeRef.current(next);
  }, []);

  const endHold = useCallback(
    (cancelled: boolean) => {
      if (!holdingRef.current) return;
      clearActivateTimer();
      const wasActivated = activatedRef.current;
      holdingRef.current = false;
      activatedRef.current = false;
      startEventRef.current = null;
      setPressed(false);
      setArmed(false);
      // Finger left before activate — never opened the mic; stay quiet.
      if (!wasActivated) return;
      endRef.current(cancelled);
    },
    [clearActivateTimer, setArmed],
  );

  const activate = useCallback(() => {
    activateTimerRef.current = null;
    if (!holdingRef.current || activatedRef.current) return;
    activatedRef.current = true;
    setPressed(true);
    const ev = startEventRef.current;
    if (ev) startRef.current(ev);
    else startRef.current({ nativeEvent: {} } as GestureResponderEvent);
  }, []);

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
      activatedRef.current = false;
      // Pressed style waits for activate on Android so taps do not flash.
      if (PRESS_ACTIVATE_MS <= 0) setPressed(true);
      armedRef.current = false;
      startedAtRef.current = Date.now();
      originXRef.current = e.nativeEvent.pageX;
      originYRef.current = e.nativeEvent.pageY;
      startEventRef.current = e;
      clearActivateTimer();
      if (PRESS_ACTIVATE_MS <= 0) {
        activate();
      } else {
        activateTimerRef.current = setTimeout(activate, PRESS_ACTIVATE_MS);
      }
      if (Platform.OS === "ios") {
        const { locationX, locationY } = e.nativeEvent;
        if (leftHitRing(locationX, locationY)) {
          endHold(true);
        }
      }
    },
    [activate, clearActivateTimer, endHold, leftHitRing],
  );

  const onTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      if (!holdingRef.current) return;
      const { locationX, locationY, pageX, pageY } = e.nativeEvent;
      const armed = Date.now() - startedAtRef.current >= MOVE_ARM_MS;
      if (armed && Platform.OS === "ios" && leftHitRing(locationX, locationY)) {
        endHold(true);
        return;
      }
      // Until MOVE_ARM_MS, ignore slide-cancel — Samsung often jumps pageX/Y once.
      if (!armed) return;
      const slid =
        directionRef.current === "left"
          ? originXRef.current - pageX > HOLD_TO_TALK_CANCEL_PX
          : originYRef.current - pageY > HOLD_TO_TALK_CANCEL_PX;
      setArmed(slid);
    },
    [endHold, leftHitRing, setArmed],
  );

  const onTouchEnd = useCallback(() => endHold(false), [endHold]);

  const onTouchCancel = useCallback(() => {
    if (IGNORE_TOUCH_CANCEL) return;
    endHold(true);
  }, [endHold]);

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
