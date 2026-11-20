package theme

import "testing"

func TestResolveTracksSystemAndOverrides(t *testing.T) {
	if got := Resolve(ModeSystem, false); got.Dark {
		t.Fatal("expected light tokens in system light mode")
	}
	if got := Resolve(ModeSystem, true); !got.Dark {
		t.Fatal("expected dark tokens in system dark mode")
	}
	if got := Resolve(ModeDark, false); !got.Dark || !got.Theme.Dark {
		t.Fatal("expected dark override to force dark theme")
	}
	if got := Resolve(ModeLight, true); got.Dark || got.Theme.Dark {
		t.Fatal("expected light override to force light theme")
	}
}
