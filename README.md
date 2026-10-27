# Vibetar Editor

**Your guitar, your setup.**

A browser-based configuration editor for Vibetar guitar firmware and its Pico W
receiver. Remap inputs, calibrate sensors, monitor your controller, and save
settings directly to the board using WebHID over USB or supported Bluetooth HID.

Built with HTML, CSS, and JavaScript modules: no package installation, build step,
backend, telemetry, or external fonts. Vibetar was developed with AI assistance;
its name combines *vibe coding* and *guitar*.

## Features

- Button GPIO mapping and whammy calibration.
- Solo frets, left/right D-pad, and Rock Band effects-selector configuration.
- Digital, ADC, or ADXL345 tilt/Star Power setup with live readings.
- Live GPIO map, ADC monitor, and controller preview.
- USB host policies and Guitar Hero/Rock Band startup profiles.
- Event-driven LEDs and optional VSYS low-battery monitoring.
- Bluetooth pairing controls, diagnostics, and Pico W receiver discovery.
- JSON import/export, factory defaults, restart, and BOOTSEL commands.

Available sections depend on the firmware's advertised capabilities. A standard
Pico supports USB; Bluetooth requires Pico W. XInput guitar profiles use USB.
The interface supports **English** and **Português (Brasil)**. It uses your saved
language choice first, then the first supported browser language, with English
as the fallback. Change it at any time using the header language selector.

## Install and run locally

You need a recent Node.js release (Node 22 is used in CI), Chrome or Edge with
WebHID support, and a board running Vibetar firmware.

Clone this editor repository, open a terminal in its directory, and run:

```sh
node server.mjs
```

Open [localhost:8080](http://localhost:8080). No `npm install` is needed.
The development server listens only on the local machine.

For another port in PowerShell:

```powershell
$env:PORT = 8081
node server.mjs
```

You can also serve the files locally using Python:

```sh
python -m http.server 8080 --bind 127.0.0.1
```

## Connect and configure

1. Flash `vibetar.uf2` on the guitar, or `vibetar-receiver.uf2` on a Pico W receiver,
   using BOOTSEL and the RPI-RP2 drive. Build instructions are in the firmware README.
2. Connect the board over USB in **HID** mode. If necessary, hold Start + Back
   while powering on, without MODE, to force HID for that session.
3. Click **Connect Pico** and select the board in the browser's permission dialog.
4. The editor reads the current settings. Adjust the desired section and use
   its save button. Saving confirms both firmware status and the returned values.
5. Reconnect after switching USB modes or restarting the board.

The browser grants access per device and origin. Switching to Guitar Hero or
Rock Band XInput disconnects the USB HID configuration interface; return to HID
before reconnecting the editor.

GPIO labels refer to **logical GPIO numbers**, not physical header pins.
Buttons connect GPIO to GND, using internal pull-ups. Digital mappings use
GP0–GP22; analog inputs use GP26–GP28. The editor rejects conflicting assignments.
GPIOs use **3.3 V**.

### Saving and backups

Settings persist in the board's flash after power-off. Each section has its own
save action. Importing JSON creates local drafts; it does not write to the board
until you save the relevant sections. Export JSON before changing an existing
setup. Factory reset restores the firmware's defaults.

Make configuration changes outside gameplay: writing flash briefly pauses input
processing. Configuration stays between the browser and the board.

### Bluetooth HID

Enable Bluetooth on a Pico W guitar through the USB editor first, then pair
**Vibetar Guitar** in the computer's Bluetooth settings. Open a pairing window
when adding a new host; the window lasts 120 seconds.

WebHID over Bluetooth requires the operating system to expose the vendor HID
configuration collection. If the guitar works in games but is absent from the
editor, use **Diagnose HID** or configure over USB. After a firmware update,
removing the old pairing and pairing again may be necessary.

Disabling Bluetooth or clearing bonds can end the editor connection. Use USB to
enable Bluetooth again. The guitar supports one Bluetooth connection at a time.

### Pico W receiver

Flash the receiver UF2 to a second Pico W. Open pairing on the guitar, connect
the receiver to the editor over USB HID, click **Search guitars**, select the
guitar, and choose **Connect guitar**. Wait for the receiving-controls status;
the receiver then saves the peer for automatic reconnection.

Disconnect the guitar from other Bluetooth hosts before pairing. If the guitar
stays enumerated over USB, disable **Prioritize USB** on the guitar to send real
controls wirelessly. Button and sensor settings belong on the guitar; editing
GPIOs on the receiver changes the receiver's own settings.

### Restart and update

**Restart Pico** restarts the firmware. **Enter BOOTSEL** puts the board in
the ROM bootloader so you can copy a new UF2 to RPI-RP2. The editor does not
transfer firmware files. Neither command performs a factory reset.

## Host as a static site

Publish `index.html`, `styles.css`, and **all browser `.mjs` modules in the root**
and the **`locales/` directory** to an HTTPS static host. Exclude `server.mjs`, which is only the local development
server. There are no assets to compile and no server-side application to deploy.

WebHID requires **HTTPS or localhost** and browser support. Open the site directly;
an iframe or a restrictive Permissions Policy can block HID access. Supported
browsers still ask the user to authorize each device.

## Translations

Messages live in `locales/en.mjs` and `locales/pt-BR.mjs`. Use compact, stable
English IDs grouped by feature, such as `connection.connect`,
`controls.strumUp`, and `validation.configSchema`. Keep the same keys and
numbered placeholders (such as `{0}`) in both files. Text belongs in the
catalog values; changing a sentence should not require renaming its key. `i18n.mjs` handles language resolution, persistence,
formatting, and DOM bindings. Visible text and accessibility labels change
without recreating inputs or writing settings to the board.

To add a language, add its catalog, register it in `i18n.mjs` (including language
matching), and add it to the selector in `index.html`. Native browser dialogs
and operating-system error messages use their own language settings.

## Tests and compatibility

```sh
node --test tests/*.test.mjs
```

Tests use Node's built-in runner and simulated HID devices. They cover report
encoding, validation, write confirmation, firmware capability checks, and
connection failures. Physical hardware and OS-specific Bluetooth behavior still
need testing on the actual setup.

Detailed protocol and hardware notes are intended for a future GitHub Wiki.

## License

Original editor code is licensed under the [MIT License](LICENSE).
