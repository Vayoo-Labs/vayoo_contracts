for prog in `ls programs`;
do PROG_NAME=$(echo $prog | sed 's/-/_/g') ;
  PROG_KP=$(solana address -k target/deploy/$PROG_NAME-keypair.json) ;
  sed -i "" "s/^$PROG_NAME = .*/$PROG_NAME = \"$PROG_KP\"/g" Anchor.toml ;
  sed -i "" "s/^declare_id\!.*/declare_id\!(\"$PROG_KP\")\;/g" programs/$prog/src/lib.rs;
done