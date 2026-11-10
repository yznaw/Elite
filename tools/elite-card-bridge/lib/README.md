# QNB DLL package (not committed)

Copy the files delivered by QNB / Ideal Solutions here before building the
Windows bridge. They are bank property (Technical Guide §2, Document Policy)
and are ignored by git.

Required (v5.0.0.13 for the Newland N910):

- Ideal.PointOfSale.Integration.dll
- InTheHand.Net.Personal.dll
- log4net.dll
- log4net.config
- MaterialDesignColors.dll
- MaterialDesignThemes.Wpf.dll
- Newtonsoft.Json.dll
- Scs.dll

When `Ideal.PointOfSale.Integration.dll` is present the build defines
`QNB_DLL` and includes the real terminal. Without it the bridge builds in
simulator-only mode.
