# unc command groups

The following groups are exposed by the official `unc` CLI. Use the
`ugreen_nas` tool with an argv array.

## file
`ls`, `cat`, `head`, `tail`, `stat`, `search`, `download`, `upload`, `rm`,
`mv`, `cp`, `mkdir`, `touch`, `tee`, `gen-thumb`, `quota`, `tag`.

`file rm` defaults to the recycle bin. Destructive operations require explicit
confirmation.

## docker
`images`, `ps`, `logs`, `pull`, `start`, `stop`, `restart`, `rebuild`,
`search`, `stats`, `compose`, `dir-check`, `gpu-check`, `port-check`.

## download
`ls`, `status`, `create`, `pause`, `resume`, `retry`, `rm`.

## storage
`disk`, `pool`, `volume`.

## app
`get`, `ls`, `search`, `status`, `install`, `update`, `start`, `stop`,
`uninstall`.

## search
`title`, `results`, `cancel`, `rm`.

## ctl
`group`, `hardware`, `os`, `user`.

## network
`general`, `iface`.

## taskmgr
CPU, GPU, memory, network, disk, service, process, and combined resource views.

For exact flags and machine-readable fields, use `ugreen_nas` with
`["<group>","<action>","--help"]`; the plugin blocks only the groups listed in
its safety policy.
