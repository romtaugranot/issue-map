# The HTML Picture draws Groups as islands

ADR 0010 settled what the HTML Picture holds; this settles how it looks. The first page was a header, Take next as a numbered list, every Group as a square tile, and an opened Group as small boxes joined by straight lines, in the system's colours. It held everything, but read as a dump: nothing said where to start, the tiles gave a Group's size and little else, and on a phone an opened Group was a few boxes in a wide picture.

The page now starts from the one thing it is for. Its head names the Project, how old the Snapshot is, any warning, and the first Issue in Take next, which opens where it sits. Under it, each Group is an island, sized by its Issues and Outside Issues, packed from the largest out. A ring round each fills with the share Unblocked, and a dot marks one holding an Issue in Take next. Selecting an island zooms into it, and its Issues rise in from its top, layer by layer, the lines between them drawing in. On a narrow screen they stand in one column, each indented under the Issue it was first reached from. An Issue's card slides up with its copy button.

Take next, with the Issues taken by others, every Group, and the Unlinked Issues are lists that slide in from the side, so nothing ADR 0010 promised is dropped. The 150 largest Groups are drawn as islands; the Groups list holds every one. A layer too wide to draw folds into "more", which opens the Group as one outline.

The colours are a sea chart's: deep or pale water, islands with a dotted shore, teal for Unblocked, coral for Blocks, and a lantern's amber for Take next, for light and dark alike. Motion answers the user's choice and is dropped under reduced motion; the one unasked motion is the islands rising when the page opens.

## Considered Options

The four were drawn from the recorded Snapshots of opentofu, rust and playwright, at desktop and phone widths, on a throwaway branch (`prototype/map-page-look`).

- **Queue**: Take next first, with Groups as a list beside it. Clear, but the Map's shape was gone.
- **Panes**: Groups on the left, the chosen one's outline on the right. A file browser rather than a map.
- **Map first**: a treemap of Groups beside Take next. Dense, and cramped on a phone.
- **The drawn map**: every Issue of every Group laid out at once. Too cluttered to read.

## Consequences

- **The page still makes no request and holds no web font.** It uses the system's faces, as before.
- **Its script is untested in a browser by CI.** The suite checks it compiles, its colours and its data; the look was checked by eye from screenshots on the recorded Snapshots.
