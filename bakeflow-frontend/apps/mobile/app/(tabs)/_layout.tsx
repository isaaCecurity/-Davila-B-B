import { duration, easing, motion, TabBar } from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Easing } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useActivePersona } from '../../features/auth/hooks/useActivePersona';
import { PERSONA_TABS, TAB_DEFS, TAB_ROUTES } from '../../navigation/tabs';

const [x1, y1, x2, y2] = easing.out;

/**
 * The role-adaptive tab shell.
 *
 * Every tab route is registered for every role — Expo Router needs the files to exist — and
 * the bar shows only the persona's set. Routes outside it get `href: null` so they are not
 * linkable from the bar.
 *
 * Tab switch reproduces the prototype's `tab-in`: the incoming scene fades up from 7px below
 * over 215ms on the ease-out curve. It is off entirely when the OS asks for reduced motion.
 *
 * PORT-NOTE: scene transitions run on the navigator's own animation system (native driver)
 * rather than Reanimated, because that is what the tab navigator drives; component-level
 * motion everywhere else is Reanimated.
 */
export default function TabsLayout(): React.JSX.Element {
  const persona = useActivePersona();
  const visible = PERSONA_TABS[persona];
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  return (
    <Tabs
      // Some tab routes are also reached from other screens (Finance → Cash sessions). Walking
      // back through visit history returns there, instead of dropping to the first tab.
      backBehavior="history"
      tabBar={({ state, navigation }) => {
        const active = state.routes[state.index]?.name ?? 'index';
        return (
          <TabBar
            items={visible.map((key) => ({ key, ...TAB_DEFS[key] }))}
            activeKey={active}
            onPress={(key) => {
              if (key !== active) navigation.navigate(key);
            }}
            fab={
              persona === 'driver'
                ? { label: 'New ticket', onPress: () => router.push('/driver/sell') }
                : undefined
            }
          />
        );
      }}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
        animation: reducedMotion ? 'none' : 'fade',
        transitionSpec: {
          animation: 'timing',
          config: { duration: duration.base, easing: Easing.bezier(x1, y1, x2, y2) },
        },
        sceneStyleInterpolator: ({ current }) => ({
          sceneStyle: {
            opacity: current.progress.interpolate({
              inputRange: [-1, 0, 1],
              outputRange: [0, 1, 0],
            }),
            transform: [
              {
                translateY: current.progress.interpolate({
                  inputRange: [-1, 0, 1],
                  outputRange: [motion.tabInY, 0, motion.tabInY],
                }),
              },
            ],
          },
        }),
      }}
    >
      {TAB_ROUTES.map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{ href: visible.includes(name) ? undefined : null }}
        />
      ))}
    </Tabs>
  );
}
